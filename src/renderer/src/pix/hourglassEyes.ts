import type { PixShape } from '@shared/mascot'
import { BODY_SHAPES, PIX_ANCHOR } from './geometry'
import { hourglassGeometry, restBody } from './shapes'

/**
 * Clessidra: gli occhi sono i chicchi. Una piccola simulazione fisica:
 * ogni occhio è una pallina con la gravità che scivola lungo le pareti
 * inclinate dell'ampolla, si stringe per passare dal collo, cade accelerando,
 * rimbalza appena sul fondo e si appoggia all'altro occhio. Quando sono scesi
 * la clessidra si capovolge e cadono di nuovo; alla fine si rigira e torna Pix.
 *
 * Gli occhi scendono dentro il fluido di Pix: c'è attrito, quindi cadono con calma
 * (velocità limite) e nel collo rallentano ancora, come in un liquido denso.
 *
 * Tempi (s, su HOURGLASS_S = 6,8; il corpo entra in 0,6 ed esce negli ultimi 0,7):
 *  0–0.9 il corpo diventa clessidra e gli occhi salgono nell'ampolla di sopra;
 *  0.9 cadono: il primo passa dal collo, il secondo lo segue;
 *  2.5–3.2 capovolta; 3.3 ricadono; 5.4–6.1 si rigira; poi tornano al loro posto.
 */
const T = { lift: 0.9, release1: 0.9, release2: 0.9, flip1: 2.5, flip1End: 3.2, release3: 3.3, release4: 3.5, flip2: 5.4, flip2End: 6.1, end: 6.8 }

interface Eye {
  x: number
  y: number
  vx: number
  vy: number
  rest: [number, number]
  start: [number, number]
  /** 0 = forma normale dell'occhio, 1 = chicco tondo. */
  round: number
}

const ease = (x: number) => {
  const k = Math.min(1, Math.max(0, x))
  return k * k * (3 - 2 * k)
}

export function runHourglassEyes(opts: {
  start: number
  eyes: SVGGElement
  flip: SVGGElement
  scale: number
  shape: PixShape
}): () => void {
  const { eyes, flip, scale: s, shape } = opts
  const b = restBody(s, shape)
  const g = hourglassGeometry(b)
  const topY = g.neckY - g.Hc - 2 * g.s
  const neck = 3.2 * g.s
  const re = 3.4 * s
  const gravity = 900 * s
  /** Attrito del fluido (1/s): nel collo è molto più forte. */
  const drag = 6
  const neckDrag = 26
  const pivot = g.neckY - g.s
  // Mezza larghezza interna della clessidra all'altezza y (come la sagoma del corpo).
  const half = (y: number) => {
    const p = y < g.neckY - 2 * g.s ? (g.neckY - 2 * g.s - y) / g.Hc : y > g.neckY ? (y - g.neckY) / (g.bottom - g.neckY) : 0
    const q = Math.min(1, Math.max(0, p))
    return neck + (g.Wc + 2 * g.s - neck) * (1 - (1 - q) ** 2.2)
  }
  // Centro degli occhi a riposo (coordinate dell'SVG).
  const fx = PIX_ANCHOR.x - 50 * s
  const fy = PIX_ANCHOR.y - 88 * s + BODY_SHAPES[shape].faceDy * s
  const els = [eyes.children[0], eyes.children[1]] as Array<SVGGraphicsElement | undefined>
  // Ogni occhio diventa un chicco tondo del raggio della simulazione (le pillole si arrotondano).
  const base = els.map((el) => {
    try {
      const bb = el?.getBBox()
      if (!bb || !bb.width || !bb.height) return [1, 1] as const
      return [(2 * re) / s / bb.width, (2 * re) / s / bb.height] as const
    } catch {
      return [1, 1] as const
    }
  })
  // Partono a metà dell'ampolla di sopra, uno un po' più in alto dell'altro: cadono
  // insieme, il primo infila il collo e il secondo gli si appoggia sopra e aspetta.
  const midY = g.neckY - 2 * g.s - g.Hc * 0.5
  const mk = (ex: number, dx: number, dy: number): Eye => {
    const rest: [number, number] = [fx + ex * s, fy + 52 * s]
    const start: [number, number] = [g.cx + dx * s, midY + dy * s]
    return { x: rest[0], y: rest[1], vx: 0, vy: 0, rest, start, round: 0 }
  }
  const pair = [mk(41, -2.5, 3), mk(59, 4, -6)]
  // Le pillole (rect) hanno gli angoli tondi: si arrotondano del tutto per diventare chicchi.
  const rx = els.map((el) => (el?.tagName.toLowerCase() === 'rect' ? Number(el.getAttribute('rx')) || 0 : 0))

  let raf = 0
  let last = performance.now()
  let dir = 1 // verso della gravità nel riferimento del corpo (si inverte con la capovolta)

  const collide = () => {
    const [a, c] = pair as [Eye, Eye]
    const dx = c.x - a.x
    const dy = c.y - a.y
    const d = Math.hypot(dx, dy) || 0.001
    const min = 2 * re
    if (d >= min) return
    const nx = dx / d
    const ny = dy / d
    const push = (min - d) / 2
    a.x -= nx * push
    a.y -= ny * push
    c.x += nx * push
    c.y += ny * push
    // Uno esattamente sopra l'altro non sta in equilibrio: quello sopra scivola di lato.
    if (Math.abs(nx) < 0.2) {
      const top = ny * dir > 0 ? a : c
      top.x += (nx >= 0 ? -1 : 1) * 0.12 * s
    }
    const rel = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny
    if (rel < 0) {
      const j = -(1 + 0.2) * rel * 0.5
      a.vx -= j * nx
      a.vy -= j * ny
      c.vx += j * nx
      c.vy += j * ny
    }
  }

  const simulate = (e: Eye, dt: number) => {
    e.vy += gravity * dir * dt
    const tight = Math.max(0, 1 - (half(e.y) - re) / (2 * re))
    const k = drag + (neckDrag - drag) * tight
    e.vy -= e.vy * Math.min(1, k * dt)
    e.vx -= e.vx * Math.min(1, k * dt)
    e.x += e.vx * dt
    e.y += e.vy * dt
    // Pareti dell'ampolla: si scivola lungo il vetro verso il collo.
    const w = half(e.y) - re
    if (w <= 0) {
      e.x += (g.cx - e.x) * 0.6
      e.vx *= 0.5
    } else if (Math.abs(e.x - g.cx) > w) {
      const side = Math.sign(e.x - g.cx)
      e.x = g.cx + side * w
      if (e.vx * side > 0) e.vx = -e.vx * 0.15
      e.vy *= 0.985
    }
    // Fondo (o cima, dopo la capovolta): rimbalzo piccolo e poi si appoggia.
    const floor = dir > 0 ? g.bottom - re - 1.2 * s : topY + re + 1.2 * s
    if ((dir > 0 && e.y > floor) || (dir < 0 && e.y < floor)) {
      e.y = floor
      e.vy = Math.abs(e.vy) > 40 * s ? -e.vy * 0.25 : 0
      e.vx *= 0.75
    }
  }

  const draw = (rot: number) => {
    flip.setAttribute('transform', `rotate(${rot.toFixed(2)} ${g.cx.toFixed(2)} ${pivot.toFixed(2)})`)
    pair.forEach((e, i) => {
      const el = els[i]
      if (!el) return
      // Nel collo l'occhio si stringe; cadendo si allunga un poco.
      const room = (half(e.y) / re) * 0.9
      const squeeze = Math.min(1, Math.max(0.42, room))
      const stretch = 1 + Math.min(0.22, (Math.abs(e.vy) / s) * 0.00035)
      // Fuori dalla clessidra (all'inizio e alla fine) l'occhio ha la sua forma di sempre.
      const round = e.round
      const [bx, by] = base[i]!
      const sx = (1 + (bx - 1) * round) * (squeeze / Math.sqrt(stretch))
      const sy = (1 + (by - 1) * round) * (stretch / Math.sqrt(squeeze))
      const [ox, oy] = e.rest
      if (rx[i]) el.setAttribute('ry', ((rx[i]! * (1 + (bx - 1) * round)) / (1 + (by - 1) * round)).toFixed(2))
      el.setAttribute(
        'transform',
        `translate(${((e.x - ox) / s).toFixed(2)} ${((e.y - oy) / s).toFixed(2)}) translate(${(ox - fx) / s} ${(oy - fy) / s}) scale(${sx.toFixed(3)} ${sy.toFixed(3)}) translate(${-(ox - fx) / s} ${-(oy - fy) / s})`
      )
    })
  }

  const step = (now: number) => {
    const t = (now - opts.start) / 1000
    const dt = Math.max(0, Math.min(1 / 30, (now - last) / 1000))
    last = now
    let rot = 0
    if (t < T.lift) {
      // Salgono nell'ampolla di sopra mentre il corpo diventa clessidra.
      const k = ease(t / T.lift)
      pair.forEach((e) => {
        e.x = e.rest[0] + (e.start[0] - e.rest[0]) * k
        e.y = e.rest[1] + (e.start[1] - e.rest[1]) * k
        e.round = k
      })
    } else if (t < T.flip1) {
      const sub = 4
      for (let i = 0; i < sub; i++) {
        if (t >= T.release1) simulate(pair[0]!, dt / sub)
        if (t >= T.release2) simulate(pair[1]!, dt / sub)
        collide()
      }
    } else if (t < T.flip1End) {
      rot = 180 * ease((t - T.flip1) / (T.flip1End - T.flip1))
      dir = -1
      pair.forEach((e) => {
        e.vx = 0
        e.vy = 0
      })
    } else if (t < T.flip2) {
      rot = 180
      const sub = 4
      for (let i = 0; i < sub; i++) {
        if (t >= T.release3) simulate(pair[1]!, dt / sub)
        if (t >= T.release4) simulate(pair[0]!, dt / sub)
        collide()
      }
    } else if (t < T.flip2End) {
      rot = 180 + 180 * ease((t - T.flip2) / (T.flip2End - T.flip2))
    } else {
      // Si è rigirata: gli occhi tornano al loro posto mentre il corpo torna Pix.
      rot = 360
      const k = ease((t - T.flip2End) / (T.end - T.flip2End))
      pair.forEach((e) => {
        e.x += (e.rest[0] - e.x) * Math.min(1, k * 1.2)
        e.y += (e.rest[1] - e.y) * Math.min(1, k * 1.2)
        e.round = 1 - k
      })
    }
    draw(rot % 360)
    if (t < T.end) raf = requestAnimationFrame(step)
    else clear()
  }

  const clear = () => {
    flip.removeAttribute('transform')
    els.forEach((el) => {
      el?.removeAttribute('transform')
      el?.removeAttribute('ry')
    })
  }

  raf = requestAnimationFrame(step)
  return () => {
    cancelAnimationFrame(raf)
    clear()
  }
}
