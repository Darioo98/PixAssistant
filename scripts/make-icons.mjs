// Genera le icone (area di notifica e installer) dalla bozza di Pix.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const svg = await readFile('assets/pix/pix-normale.svg')
// Ritaglio sul corpo di Pix (senza ombra), così l'icona è più leggibile a 16 px.
const cropped = Buffer.from(
  svg.toString().replace('viewBox="0 0 100 100"', 'viewBox="14 19 72 72"').replace(/<ellipse[^>]*\/>/, '')
)
const png = (size) => sharp(cropped, { density: 600 }).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()

await mkdir('resources/icons', { recursive: true })
await mkdir('build', { recursive: true })
const tray = await Promise.all([16, 20, 24, 32, 40, 48].map(png))
await writeFile('resources/icons/tray.ico', await pngToIco(tray))
const app = await Promise.all([16, 24, 32, 48, 64, 128, 256].map(png))
await writeFile('build/icon.ico', await pngToIco(app))
await writeFile('resources/icons/pix-256.png', app[app.length - 1])
console.log('Icone generate')
