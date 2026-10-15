import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { docxText, pptxText, readAttachment, readableKind, xlsxText } from '../src/main/attachments'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pix-att-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Zip minimo con file compressi (come quelli di Office). */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
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
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBuf, comp)
    centrals.push(central, nameBuf)
    offset += local.length + nameBuf.length + comp.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
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
    expect(docxText(zip({ 'word/document.xml': xml }))).toBe('Contratto & allegati\nFirma\tentro')
    expect(docxText(zip({ 'altro.xml': xml }))).toBeNull()
  })

  it('estrae i fogli di Excel come tabelle e le diapositive di PowerPoint', () => {
    const xlsx = zip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="Spese" sheetId="1"/><sheet name="Note" sheetId="2"/></sheets></workbook>',
      'xl/sharedStrings.xml': '<sst><si><t>Voce</t></si><si><t>Importo</t></si><si><r><t>Af</t></r><r><t>fitto</t></r></si></sst>',
      'xl/worksheets/sheet1.xml': '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>750.5</v></c></row></sheetData>',
      'xl/worksheets/sheet2.xml': '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Pagato &amp; chiuso</t></is></c></row></sheetData>'
    })
    expect(xlsxText(xlsx)).toBe(['## Spese', 'Voce\tImporto', 'Affitto\t\t750.5', '', '## Note', 'Pagato & chiuso'].join('\n'))
    const pptx = zip({
      'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>Conclusioni</a:t></a:r></a:p></p:sld>',
      'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>Titolo</a:t></a:r></a:p><a:p><a:r><a:t>Punto </a:t></a:r><a:r><a:t>uno</a:t></a:r></a:p></p:sld>'
    })
    expect(pptxText(pptx)).toBe(['## Diapositiva 1', 'Titolo', 'Punto uno', '', '## Diapositiva 2', 'Conclusioni'].join('\n'))
    expect(readableKind('bilancio.xlsx')).toBe('xlsx')
    expect(readableKind('vecchio.xls')).toBeNull()
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
