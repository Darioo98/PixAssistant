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

/** Limiti: PDF fino a 20 MB, immagini 5 MB, documenti Office 10 MB, testo 1 MB. */
const LIMITS = { pdf: 20 * 1024 * 1024, image: 5 * 1024 * 1024, docx: 10 * 1024 * 1024, xlsx: 10 * 1024 * 1024, pptx: 20 * 1024 * 1024, text: 1024 * 1024 } as const
/** Testo massimo inviato per un documento (caratteri). */
const MAX_TEXT = 400_000

export type ReadKind = 'pdf' | 'image' | 'docx' | 'xlsx' | 'pptx' | 'text'

/** Che tipo di file è, se la chat lo sa leggere. */
export function readableKind(path: string): ReadKind | null {
  const ext = extname(path).toLowerCase()
  if (ext === '.pdf') return 'pdf'
  if (ext in IMAGE_TYPES) return 'image'
  if (ext === '.docx') return 'docx'
  if (ext === '.xlsx' || ext === '.xlsm') return 'xlsx'
  if (ext === '.pptx') return 'pptx'
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
      case 'docx':
      case 'xlsx':
      case 'pptx': {
        // Documenti Office: se ne estrae il testo qui, in locale.
        const text = kind === 'docx' ? docxText(buf) : kind === 'xlsx' ? xlsxText(buf) : pptxText(buf)
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

/** Archivio zip in sola lettura (solo voci "stored" o "deflate", come nei file di Office). */
export interface ZipReader {
  names: string[]
  read(name: string): Buffer | null
}

export function openZip(zip: Buffer): ZipReader | null {
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
  const entries = new Map<string, { method: number; size: number; local: number }>()
  let p = zip.readUInt32LE(eocd + 16)
  for (let n = 0; n < count && p + 46 <= zip.length; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) return null
    const nameLen = zip.readUInt16LE(p + 28)
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen)
    entries.set(name, { method: zip.readUInt16LE(p + 10), size: zip.readUInt32LE(p + 20), local: zip.readUInt32LE(p + 42) })
    p += 46 + nameLen + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32)
  }
  return {
    names: [...entries.keys()],
    read(name) {
      const e = entries.get(name)
      if (!e || zip.readUInt32LE(e.local) !== 0x04034b50) return null
      const start = e.local + 30 + zip.readUInt16LE(e.local + 26) + zip.readUInt16LE(e.local + 28)
      const data = zip.subarray(start, start + e.size)
      try {
        if (e.method === 0) return Buffer.from(data)
        if (e.method === 8) return inflateRawSync(data)
      } catch {
        return null
      }
      return null
    }
  }
}

/** Legge un singolo file da un archivio zip. */
export function zipEntry(zip: Buffer, wanted: string): Buffer | null {
  return openZip(zip)?.read(wanted) ?? null
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')

/** Ordina "sheet10.xml" dopo "sheet9.xml". */
const byNumber = (prefix: RegExp) => (a: string, b: string) => Number(prefix.exec(a)?.[1] ?? 0) - Number(prefix.exec(b)?.[1] ?? 0)

/** Colonna di un riferimento di cella ("C12" → 2). */
function columnOf(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A'
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/**
 * Testo di una cartella di lavoro Excel (.xlsx): ogni foglio come tabella
 * con le colonne separate da tabulazioni (valori, non formule).
 */
export function xlsxText(buf: Buffer): string | null {
  const zip = openZip(buf)
  if (!zip) return null
  const shared: string[] = []
  const sst = zip.read('xl/sharedStrings.xml')?.toString('utf8') ?? ''
  for (const si of sst.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
    shared.push(decode((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join('')))
  }
  const workbook = zip.read('xl/workbook.xml')?.toString('utf8') ?? ''
  const sheetNames = [...workbook.matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => decode(m[1]!))
  const sheetRe = /^xl\/worksheets\/sheet(\d+)\.xml$/
  const sheets = zip.names.filter((n) => sheetRe.test(n)).sort(byNumber(sheetRe))
  if (!sheets.length) return null
  const out: string[] = []
  sheets.forEach((file, i) => {
    const xml = zip.read(file)?.toString('utf8') ?? ''
    const rows: string[] = []
    for (const row of xml.match(/<row[\s\S]*?<\/row>/g) ?? []) {
      const cells: string[] = []
      for (const c of row.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
        const ref = /r="([A-Z]+\d+)"/.exec(c)?.[1] ?? ''
        const type = /t="(\w+)"/.exec(c)?.[1]
        const v = /<v>([\s\S]*?)<\/v>/.exec(c)?.[1]
        let value = ''
        if (type === 's' && v !== undefined) value = shared[Number(v)] ?? ''
        else if (type === 'inlineStr') value = decode((/<t[^>]*>([\s\S]*?)<\/t>/.exec(c)?.[1] ?? '').replace(/<[^>]+>/g, ''))
        else if (type === 'b') value = v === '1' ? 'VERO' : 'FALSO'
        else if (v !== undefined) value = decode(v)
        const col = ref ? columnOf(ref) : cells.length
        while (cells.length < col) cells.push('')
        cells[col] = value.replace(/[\t\r\n]+/g, ' ')
      }
      if (cells.some((x) => x !== '')) rows.push(cells.join('\t'))
    }
    out.push(`## ${sheetNames[i] ?? `Foglio ${i + 1}`}\n${rows.join('\n')}`)
  })
  return out.join('\n\n').trim()
}

/** Testo di una presentazione PowerPoint (.pptx), diapositiva per diapositiva. */
export function pptxText(buf: Buffer): string | null {
  const zip = openZip(buf)
  if (!zip) return null
  const slideRe = /^ppt\/slides\/slide(\d+)\.xml$/
  const slides = zip.names.filter((n) => slideRe.test(n)).sort(byNumber(slideRe))
  if (!slides.length) return null
  return slides
    .map((file, i) => {
      const xml = zip.read(file)?.toString('utf8') ?? ''
      const paragraphs = (xml.match(/<a:p>[\s\S]*?<\/a:p>/g) ?? [])
        .map((p) => decode((p.match(/<a:t>([\s\S]*?)<\/a:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join('')))
        .filter(Boolean)
      return `## Diapositiva ${i + 1}\n${paragraphs.join('\n')}`
    })
    .join('\n\n')
    .trim()
}
