import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MASCOT_SCALE, eyeColorFor, moodColor, type MascotState } from '@shared/mascot'
import type { Settings } from '@shared/settings'
import { MorphController } from './morph'
import { PIX_ANCHOR, VIEW, faceTransform } from './geometry'
import { Badge, Eyes, PixFill, Shine } from './Faces'
import { BubbleCard } from './BubbleCard'
import { useReducedMotion } from './useReducedMotion'
import './mascot.css'

const HOVER_DELAY_MS = 150
const LEAVE_DELAY_MS = 1500
const HIDE_DELAY_MS = 400
const BREATH_EVERY_MS = 25_000
const PIX_BREATH_EVERY_MS = 10_000
const EYE_RANGE = 2

interface Props {
  mascot: MascotState
  panelOpen: boolean
  settings: Settings
}

/**
 * Barra laterale e Pix sono la stessa forma: un tracciato SVG che si
 * trasforma (barra → goccia → squircle) e torna indietro. Da chiusa resta
 * solo la barra, senza animazioni attive.
 */
export function Mascot({ mascot, panelOpen, settings }: Props) {
  const { t } = useTranslation()
  const reducedMotion = useReducedMotion()
  const scale = MASCOT_SCALE[settings.mascotSize]
  const anim = settings.animations
  // Il morph risponde a un gesto dell'utente: resta anche con le animazioni spontanee spente.
  const instant = reducedMotion
  const { mood, bubble } = mascot
  const shape = settings.pixShape
  const fillId = `pix-fill-${useId().replace(/:/g, '')}`

  const bodyRef = useRef<SVGPathElement>(null)
  const faceRef = useRef<SVGGElement>(null)
  const shadowRef = useRef<SVGEllipseElement>(null)
  const lookRef = useRef<SVGGElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const morph = useRef<MorphController | null>(null)

  const [hovered, setHovered] = useState(false)
  const [formed, setFormed] = useState(false)
  const [collapsed, setCollapsed] = useState(true)
  const [blink, setBlink] = useState(false)
  const [breathing, setBreathing] = useState(false)
  const [lookAround, setLookAround] = useState(false)
  const [pixBreath, setPixBreath] = useState(false)
  const [fadeKey, setFadeKey] = useState(0)

  const wantPix = panelOpen || hovered || bubble !== null || mascot.spotlight

  // ---- Controller del morph ----
  useLayoutEffect(() => {
    const els = { body: bodyRef.current!, face: faceRef.current!, shadow: shadowRef.current! }
    morph.current = new MorphController(els, scale, shape, (isFormed) => {
      setFormed(isFormed)
      setCollapsed(!isFormed)
      if (isFormed) setBlink(true) // battito di palpebre di saluto
    })
    return () => morph.current?.dispose()
  }, [])

  useEffect(() => morph.current?.setShape(scale, shape), [scale, shape])

  useEffect(() => {
    const m = morph.current
    if (!m) return
    if (wantPix) {
      setCollapsed(false)
      if (instant) setFadeKey((k) => k + 1)
      m.go(1, instant)
      return
    }
    // Pix resta un attimo prima di tornare barra (il ritardo dell'hover è già incluso).
    setFormed(false)
    const id = window.setTimeout(() => {
      if (instant) setFadeKey((k) => k + 1)
      m.go(0, instant)
    }, HIDE_DELAY_MS)
    return () => window.clearTimeout(id)
  }, [wantPix, instant])

  // ---- Hover sulla barra / su Pix / sul fumetto ----
  useEffect(() => {
    let enter: number | undefined
    let leave: number | undefined
    let inside = false
    const set = (now: boolean) => {
      if (now === inside) return
      inside = now
      window.clearTimeout(enter)
      window.clearTimeout(leave)
      if (now) enter = window.setTimeout(() => setHovered(true), HOVER_DELAY_MS)
      else leave = window.setTimeout(() => setHovered(false), LEAVE_DELAY_MS)
    }
    const onMove = (e: MouseEvent) => set(e.target instanceof Element && e.target.closest('[data-pix-zone]') !== null)
    const onLeave = () => set(false)
    document.addEventListener('mousemove', onMove, { passive: true })
    document.addEventListener('mouseleave', onLeave)
    return () => {
      window.clearTimeout(enter)
      window.clearTimeout(leave)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  // ---- Battito di palpebre casuale (4–8 s; più raro con animazioni ridotte) ----
  useEffect(() => {
    if (!formed || anim === 'off' || mood === 'sleep' || mood === 'happy' || mood === 'greet') return
    const [min, max] = anim === 'low' ? [8000, 14000] : [4000, 8000]
    let id: number
    const schedule = () => {
      id = window.setTimeout(() => {
        setBlink(true)
        schedule()
      }, min + Math.random() * (max - min))
    }
    schedule()
    return () => window.clearTimeout(id)
  }, [formed, anim, mood])

  // ---- Piccole animazioni spontanee: ogni tanto si guarda intorno ----
  useEffect(() => {
    if (!formed || anim !== 'normal' || mood !== 'normal') return
    let id: number
    const schedule = () => {
      id = window.setTimeout(() => {
        setLookAround(true)
        schedule()
      }, 20_000 + Math.random() * 20_000)
    }
    schedule()
    return () => window.clearTimeout(id)
  }, [formed, anim, mood])

  // ---- Respiro di Pix: un ciclo ogni 10 s invece di un'animazione continua.
  // La finestra è trasparente: ogni fotogramma animato la ridisegna tutta. ----
  useEffect(() => {
    if (!formed || anim !== 'normal' || mood !== 'normal') return
    const id = window.setInterval(() => setPixBreath(true), PIX_BREATH_EVERY_MS)
    return () => window.clearInterval(id)
  }, [formed, anim, mood])

  // ---- Respiro della barra: un ciclo ogni 25 s, poi nessuna animazione attiva ----
  useEffect(() => {
    if (!collapsed || anim === 'off' || reducedMotion) return
    const id = window.setInterval(() => setBreathing(true), BREATH_EVERY_MS)
    return () => window.clearInterval(id)
  }, [collapsed, anim, reducedMotion])

  // ---- Occhi che seguono il cursore quando è vicino (dentro la finestra) ----
  const follow = formed && settings.eyesFollowCursor && anim !== 'off' && (mood === 'normal' || mood === 'greet')
  useEffect(() => {
    const look = lookRef.current
    if (!follow || !look) return
    const onMove = (e: MouseEvent) => {
      const r = svgRef.current?.getBoundingClientRect()
      if (!r) return
      const cx = r.left + (PIX_ANCHOR.x / VIEW.width) * r.width
      const cy = r.top + ((PIX_ANCHOR.y - 33 * scale) / VIEW.height) * r.height
      const dx = e.clientX - cx
      const dy = e.clientY - cy
      const dist = Math.hypot(dx, dy) || 1
      const k = Math.min(1, dist / 120) * EYE_RANGE
      look.style.transform = `translate(${((dx / dist) * k).toFixed(2)}px, ${((dy / dist) * k).toFixed(2)}px)`
    }
    document.addEventListener('mousemove', onMove, { passive: true })
    return () => {
      document.removeEventListener('mousemove', onMove)
      look.style.transform = ''
    }
  }, [follow, scale])

  const toggle = () => (panelOpen ? window.dock.closePanel() : window.dock.openPanel())
  const color = moodColor(mood, settings.pixColor)
  const face = faceTransform(scale, shape)

  return (
    <div className="mascot" style={{ ['--pix-color' as string]: color }} data-anim={anim}>
      {bubble && <BubbleCard key={bubble.id} bubble={bubble} panelOpen={panelOpen} />}
      <svg
        ref={svgRef}
        style={{ color: eyeColorFor(color) }}
        className={`mascot-svg ${instant && fadeKey ? `fade-${fadeKey % 2}` : ''}`}
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
        width={VIEW.width}
        height={VIEW.height}
        overflow="visible"
      >
        <PixFill id={fillId} color={color} finish={settings.pixFinish} />
        {/* Area sensibile più larga della barra (24 px) */}
        {!panelOpen && (
          <rect
            className="bar-zone"
            x={VIEW.width - 24}
            y="50"
            width="24"
            height="180"
            fill="transparent"
            data-hit
            data-pix-zone
            onClick={toggle}
          />
        )}
        <ellipse ref={shadowRef} cx={PIX_ANCHOR.x} cy={PIX_ANCHOR.y + 6} rx={24 * scale} ry="3" fill="#000" opacity="0" />
        <g className={`pose ${formed ? `pose-${mood}` : ''}`}>
          <g
            className={`motion ${formed ? `motion-${mood}` : ''} ${pixBreath ? 'breath' : ''}`}
            onAnimationEnd={(e) => e.animationName === 'pix-breathe' && setPixBreath(false)}
          >
            <path
              ref={bodyRef}
              className={`body ${breathing && collapsed ? 'breathe' : ''}`}
              fill={`url(#${fillId})`}
              data-hit
              data-pix-zone
              role="button"
              aria-label={t('pix.label')}
              onClick={toggle}
              onAnimationEnd={() => setBreathing(false)}
            />
            <g ref={faceRef} transform={face} opacity="0" pointerEvents="none">
              {settings.pixShine && <Shine />}
              <g
                ref={lookRef}
                className="look"
                onAnimationEnd={(e) => {
                  if (e.animationName === 'pix-blink') setBlink(false)
                  if (e.animationName === 'pix-look-around') setLookAround(false)
                }}
              >
                <g className={`glance ${lookAround ? 'look-around' : ''} ${formed && mood === 'think' ? 'thinking' : ''}`}>
                  <g className={`eyes ${blink ? 'blink' : ''}`}>
                    <Eyes mood={formed ? mood : 'normal'} style={settings.pixEyes} />
                  </g>
                </g>
              </g>
            </g>
          </g>
        </g>
        {formed && (
          <g transform={face} pointerEvents="none">
            <Badge mood={mood} />
          </g>
        )}
      </svg>
    </div>
  )
}
