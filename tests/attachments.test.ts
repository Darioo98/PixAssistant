import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { docxText, readAttachment, readableKind } from '../src/main/attachments'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pix-att-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Zip minimo con un file compresso (come quelli di Word). */
function zip(name: string, content: string): Buffer {
  const data = Buffer.from(content, 'utf8')
  const comp = deflateRawSync(data)
  const nameBuf = Buffer.from(name)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(8, 8)
  local.writeUInt32LE(comp.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(nameBuf.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(8, 10)
  central.writeUInt32LE(comp.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(nameBuf.length, 28)
  central.writeUInt32LE(0, 42)
  const cdOffset = local.length + nameBuf.length + comp.length
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length + nameBuf.length, 12)
  end.writeUInt32LE(cdOffset, 16)
  return Buffer.concat([local, nameBuf, comp, central, nameBuf, end])
}

describe('documenti per la chat', () => {
  it('riconosce i tipi leggibili', () => {
    expect(readableKind('a.PDF')).toBe('pdf')
    expect(readableKind('foto.jpeg')).toBe('image')
    expect(readableKind('lettera.docx')).toBe('docx')
    expect(readableKind('note.md')).toBe('text')
    expect(readableKind('setup.exe')).toBeNull()
  })

  it('estrae il testo da Word', () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>Contratto &amp; allegati</w:t></w:r></w:p><w:p><w:r><w:t>Firma</w:t><w:tab/><w:t>entro</w:t></w:r></w:p></w:body></w:document>'
    expect(docxText(zip('word/document.xml', xml))).toBe('Contratto & allegati\nFirma\tentro')
    expect(docxText(zip('altro.xml', xml))).toBeNull()
  })

  it('legge PDF e testo, rifiuta i formati sconosciuti', async () => {
    const pdf = join(dir, 'a.pdf')
    const txt = join(dir, 'b.txt')
    const exe = join(dir, 'c.exe')
    await writeFile(pdf, '%PDF-1.4 prova')
    await writeFile(txt, '﻿ciao')
    await writeFile(exe, 'x')
    expect(await readAttachment(pdf)).toMatchObject({ kind: 'pdf', name: 'a.pdf', data: Buffer.from('%PDF-1.4 prova').toString('base64') })
    expect(await readAttachment(txt)).toEqual({ name: 'b.txt', kind: 'text', text: 'ciao' })
    expect(await readAttachment(exe)).toEqual({ error: 'unsupported' })
    expect(await readAttachment(join(dir, 'manca.pdf'))).toEqual({ error: 'unreadable' })
  })
})
