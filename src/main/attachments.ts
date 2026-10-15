import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { inflateRawSync } from 'node:zlib'

/**
 * File che puoi far analizzare alla chat. Si leggono solo quando lo chiedi
 * (pulsante "Analizza in chat") e il contenuto va unicamente nel messaggio
 * a Claude: l'AI continua a non avere alcun accesso ai file del PC.
 */
export type Attachment =
  | { name: string; kind: 'pdf'; data: string }
  | { name: string; kind: 'image'; mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; data: string }
  | { name: string; kind: 'text'; text: string }

export type AttachmentKind = Attachment['kind']

const IMAGE_TYPES: Record<string, 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

/** Estensioni lette come testo. */
const TEXT_EXT = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.xml', '.html', '.htm', '.log', '.ini', '.cfg', '.conf', '.yaml', '.yml', '.toml',
  '.sql', '.js', '.ts', '.tsx', '.jsx', '.py', '.java', '.cs', '.c', '.cpp', '.h', '.go', '.rs', '.rb', '.php', '.sh', '.ps1', '.bat',
  '.css', '.scss', '.vue', '.kt', '.swift', '.r', '.tex', '.srt', '.eml', '.rtf'
])

/** Limiti: PDF fino a 20 MB, immagini 5 MB, Word 10 MB, testo 1 MB. */
const LIMITS = { pdf: 20 * 1024 * 1024, image: 5 * 1024 * 1024, docx: 10 * 1024 * 1024, text: 1024 * 1024 } as const
/** Testo massimo inviato per un documento (caratteri). */
const MAX_TEXT = 400_000

export type ReadKind = 'pdf' | 'image' | 'docx' | 'text'

/** Che tipo di file è, se la chat lo sa leggere. */
export function readableKind(path: string): ReadKind | null {
  const ext = extname(path).toLowerCase()
  if (ext === '.pdf') return 'pdf'
  if (ext in IMAGE_TYPES) return 'image'
  if (ext === '.docx') return 'docx'
  if (TEXT_EXT.has(ext)) return 'text'
  return null
}

export type ReadError = 'unsupported' | 'too-large' | 'unreadable'

export async function readAttachment(path: string): Promise<Attachment | { error: ReadError }> {
  const kind = readableKind(path)
  if (!kind) return { error: 'unsupported' }
  const name = basename(path)
  try {
    const info = await stat(path)
    if (!info.isFile()) return { error: 'unsupported' }
    if (info.size > LIMITS[kind]) return { error: 'too-large' }
    const buf = await readFile(path)
    switch (kind) {
      case 'pdf':
        return { name, kind: 'pdf', data: buf.toString('base64') }
      case 'image':
        return { name, kind: 'image', mediaType: IMAGE_TYPES[extname(path).toLowerCase()]!, data: buf.toString('base64') }
      case 'docx': {
        const text = docxText(buf)
        return text === null ? { error: 'unreadable' } : { name, kind: 'text', text: text.slice(0, MAX_TEXT) }
      }
      case 'text':
        return { name, kind: 'text', text: buf.toString('utf8').replace(/^﻿/, '').slice(0, MAX_TEXT) }
    }
  } catch {
    return { error: 'unreadable' }
  }
}

/** Testo di un documento Word (.docx = archivio zip con word/document.xml). */
export function docxText(zip: Buffer): string | null {
  const xml = zipEntry(zip, 'word/document.xml')
  if (!xml) return null
  return xml
    .toString('utf8')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>|<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Legge un singolo file da un archivio zip (solo "stored" o "deflate"). */
export function zipEntry(zip: Buffer, wanted: string): Buffer | null {
  // Fine della directory centrale: firma 0x06054b50, cercata dal fondo.
  let eocd = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return null
  const count = zip.readUInt16LE(eocd + 10)
  let p = zip.readUInt32LE(eocd + 16)
  for (let n = 0; n < count && p + 46 <= zip.length; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) return null
    const method = zip.readUInt16LE(p + 10)
    const size = zip.readUInt32LE(p + 20)
    const nameLen = zip.readUInt16LE(p + 28)
    const extraLen = zip.readUInt16LE(p + 30)
    const commentLen = zip.readUInt16LE(p + 32)
    const local = zip.readUInt32LE(p + 42)
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen)
    if (name === wanted) {
      if (zip.readUInt32LE(local) !== 0x04034b50) return null
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
      const data = zip.subarray(start, start + size)
      if (method === 0) return Buffer.from(data)
      if (method === 8) return inflateRawSync(data)
      return null
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  return null
}
