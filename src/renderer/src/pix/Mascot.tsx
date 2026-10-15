import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MASCOT_SCALE, NIGHT, SECTION_ANIMATIONS, eyeColorFor, moodColor, moodTransform, pickTransform, type MascotState, type PixTransform } from '@shared/mascot'
import type { Settings } from '@shared/settings'
import { MorphController } from './morph'
import { PIX_ANCHOR, VIEW, faceTransform, mouthPoint } from './geometry'
import { Badge, Eyes, PixFill, Shine } from './Faces'
import { BubbleCard } from './BubbleCard'
import { Peek } from './Peek'
import { SwallowItem, swallowKindOf, type SwallowKind } from './SwallowItem'
import { SWALLOW_S } from './shapes'
import type { DropPayload } from '@shared/extras'
import { useReducedMotion } from './useReducedMotion'
import './mascot.css'

const HOVER_DELAY_MS = 150
const LEAVE_DELAY_MS = 1500
const HIDE_DELAY_MS = 400
const BREATH_EVERY_MS = 25_000
const PIX_BREATH_EVERY_MS = 10_000
/** Evento con cui le impostazioni chiedono a Pix di provare una trasformazione. */
export const TRANSFORM_EVENT = 'pix:transform'
/** Evento con cui le impostazioni chiedono di provare la sbirciata (chiude il pannello). */
export const PEEK_EVENT = 'pix:peek'
/** Evento con cui le impostazioni chiedono di provare lo sbadiglio. */
export const YAWN_EVENT = 'pix:yawn'
/** Evento con cui le impostazioni chiedono di provare l'inghiottire (senza file vero). */
export const SWALLOW_EVENT = 'pix:swallow'

type Tired = 'none' | 'evening' | 'late'

/** Di sera Pix ha le palpebre pesanti; vicino all'ora della nanna sbadiglia. */
function tirednessAt(now: Date, settings: Settings): Tired {
  const [h, m] = (settings.dndEnabled ? settings.dndFrom : NIGHT.from).split(':').map(Number) as [number, number]
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const untilNight = (h * 60 + m - nowMin + 1440) % 1440
  if (untilNight <= 90) return 'late'
  if (untilNight <= 240) return 'evening'
  return 'none'
}
const EYE_RANGE = 2
/** Ogni quanto, a pannello chiuso, Pix sbircia da dietro la barra. */
const PEEK_MIN_MS = 45_000
const PEEK_MAX_MS = 90_000

interface Props {
  mascot: MascotState
  panelOpen: boolean
  /** Sezione aperta del pannello: Pix la accoglie con un'animazione a tema. */
  tab: string
  settings: Settings
}

/**
 * Barra laterale e Pix sono la stessa forma: un tracciato SVG che si
 * trasforma (barra → goccia → squircle) e torna indietro. Da chiusa resta
 * solo la barra, senza animazioni attive.
 */
export function Mascot({ mascot, panelOpen, tab, settings }: Props) {
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
  const [yawning, setYawning] = useState(false)
  /** Un file o un testo trascinato sopra Pix (bocca aperta) e il boccone appena inghiottito. */
  const [hungry, setHungry] = useState(false)
  /** `payload` assente = prova dalle impostazioni: nessun file da gestire. */
  const [swallow, setSwallow] = useState<{ id: number; kind: SwallowKind; from: { x: number; y: number }; payload: DropPayload | null } | null>(null)
  /** Fasi dell'inghiottire: bocca spalancata mentre arriva il boccone, poi mastica. */
  const [swallowPhase, setSwallowPhase] = useState<'open' | 'chew' | null>(null)
  const [tired, setTired] = useState<Tired>(() => tirednessAt(new Date(), settings))
  const lastTransform = useRef<PixTransform | null>(null)
  /** Sbirciata in corso e funzione che la spaventa. */
  const peekActive = useRef(false)
  const scareRef = useRef<(() => void) | null>(null)

  const wantPix = panelOpen || hovered || bubble !== null || mascot.spotlight || hungry || swallow !== null

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
      // Durante la sbirciata toccare Pix lo spaventa (rientra di colpo) invece di aprirlo.
      if (now && peekActive.current) {
        scareRef.current?.()
        return
      }
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

  // ---- Trascinare su Pix: file e cartelle diventano link, il testo una nota ----
  useEffect(() => {
    let leave: number | undefined
    const onPix = (e: DragEvent) => e.target instanceof Element && e.target.closest('[data-pix-zone]') !== null
    const accepts = (e: DragEvent) => {
      const types = Array.from(e.dataTransfer?.types ?? [])
      return types.includes('Files') || types.includes('text/plain') || types.includes('text/uri-list')
    }
    const onOver = (e: DragEvent) => {
      if (!accepts(e) || !onPix(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      setHungry(true)
      // "dragover" arriva di continuo: se smette, il trascinamento è uscito da Pix.
      window.clearTimeout(leave)
      leave = window.setTimeout(() => setHungry(false), 350)
    }
    const onDrop = (e: DragEvent) => {
      if (!accepts(e) || !onPix(e)) return
      e.preventDefault()
      const dt = e.dataTransfer
      if (!dt) return
      const paths = Array.from(dt.files)
        .map((f) => window.pix.pathForFile(f))
        .filter(Boolean)
        .slice(0, 20)
      const uri = dt.getData('text/uri-list').split(/\r?\n/).find((l) => l && !l.startsWith('#'))
      const text = paths.length ? '' : (uri ?? dt.getData('text/plain')).slice(0, 100_000)
      window.clearTimeout(leave)
      setHungry(false)
      if (!paths.length && !text.trim()) return
      // Punto da cui parte il boccone (coordinate dell'SVG).
      const r = svgRef.current?.getBoundingClientRect()
      const from = r ? { x: ((e.clientX - r.left) / r.width) * VIEW.width, y: ((e.clientY - r.top) / r.height) * VIEW.height } : { x: 90, y: 150 }
      const kind = swallowKindOf(Array.from(dt.files).map((f) => f.name), text)
      setSwallow({ id: performance.now(), kind, from, payload: { paths, text } })
    }
    document.addEventListener('dragover', onOver)
    document.addEventListener('drop', onDrop)
    return () => {
      window.clearTimeout(leave)
      document.removeEventListener('dragover', onOver)
      document.removeEventListener('drop', onDrop)
    }
  }, [])

  // ---- Inghiottire: il boccone vola in bocca, poi scende; alla fine Pix chiede cosa farne ----
  const swallowSent = useRef<number | null>(null)
  const sendDrop = (s: NonNullable<typeof swallow>) => {
    if (swallowSent.current === s.id) return
    swallowSent.current = s.id
    if (s.payload) void window.pix.drop(s.payload)
    setSwallowPhase(null)
    setSwallow(null)
  }
  useEffect(() => {
    const onTry = () => setSwallow({ id: performance.now(), kind: 'pdf', from: { x: 92, y: 110 }, payload: null })
    window.addEventListener(SWALLOW_EVENT, onTry)
    return () => window.removeEventListener(SWALLOW_EVENT, onTry)
  }, [])
  useEffect(() => {
    if (!swallow) return
    // Rete di sicurezza: se Pix non si forma, chiede comunque cosa fare.
    const id = window.setTimeout(() => sendDrop(swallow), 4000)
    return () => window.clearTimeout(id)
  }, [swallow?.id])
  useEffect(() => {
    if (!swallow || !formed) return
    if (reducedMotion) {
      sendDrop(swallow)
      return
    }
    setSwallowPhase('open')
    const started = morph.current?.swallow() ?? false
    const timers = [
      window.setTimeout(() => setSwallowPhase('chew'), SWALLOW_S.bite * 1000),
      window.setTimeout(() => setSwallowPhase(null), SWALLOW_S.chewEnd * 1000),
      window.setTimeout(() => sendDrop(swallow), (started ? SWALLOW_S.total : SWALLOW_S.bite + 0.3) * 1000)
    ]
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [swallow?.id, formed])

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

  // ---- Animazioni del fluido: il corpo si deforma e si muove, poi torna com'era ----
  const play = (kind: PixTransform, loop = false) => {
    if (reducedMotion) return
    lastTransform.current = kind
    morph.current?.start(kind, loop)
  }

  // Animazioni spontanee, ogni tanto, solo se Pix è visibile e sveglio.
  const [spontaneousTick, setSpontaneousTick] = useState(0)
  useEffect(() => {
    if (!formed || anim !== 'normal' || !settings.pixTransforms || mood !== 'normal' || reducedMotion) return
    const id = window.setTimeout(() => {
      play(pickTransform(lastTransform.current, Math.random))
      setSpontaneousTick((n) => n + 1)
    }, 35_000 + Math.random() * 35_000)
    return () => window.clearTimeout(id)
  }, [formed, anim, settings.pixTransforms, mood, reducedMotion, spontaneousTick])

  // Animazioni legate allo stato (antenne mentre pensa, cuore che batte quando festeggia):
  // durano finché dura lo stato.
  const moodAnim = formed && !reducedMotion ? moodTransform(mood) : null
  useEffect(() => {
    if (!moodAnim) return
    play(moodAnim, true)
    return () => morph.current?.stopPlay()
  }, [moodAnim])

  // Ogni sezione del pannello ha la sua animazione di benvenuto.
  useEffect(() => {
    if (!panelOpen || anim === 'off') return
    const kind = SECTION_ANIMATIONS[tab]
    if (kind) play(kind)
  }, [tab, panelOpen, anim])

  // Prova dalle impostazioni ("Prova le animazioni").
  useEffect(() => {
    const onPreview = (e: Event) => play((e as CustomEvent<PixTransform>).detail)
    window.addEventListener(TRANSFORM_EVENT, onPreview)
    return () => window.removeEventListener(TRANSFORM_EVENT, onPreview)
  }, [reducedMotion])

  // ---- Sbirciata: a pannello chiuso ogni tanto un piccolo Pix sbuca da dietro la barra ----
  const [peek, setPeek] = useState<{ y: number } | null>(null)
  const [peekSoon, setPeekSoon] = useState(false)
  const canPeek = collapsed && !wantPix && anim === 'normal' && settings.pixTransforms && !reducedMotion && mood !== 'sleep'
  peekActive.current = peek !== null && canPeek
  useEffect(() => {
    if (!canPeek) {
      setPeek(null)
      return
    }
    if (peek !== null) return
    const delay = peekSoon ? 900 : PEEK_MIN_MS + Math.random() * (PEEK_MAX_MS - PEEK_MIN_MS)
    const id = window.setTimeout(() => {
      setPeekSoon(false)
      setPeek({ y: 95 + Math.random() * 95 })
    }, delay)
    return () => window.clearTimeout(id)
  }, [canPeek, peek, peekSoon])

  // Prova dalle impostazioni: chiude il pannello e sbircia appena torna barra.
  useEffect(() => {
    const onPeek = () => {
      setPeekSoon(true)
      window.pix.closePanel()
    }
    window.addEventListener(PEEK_EVENT, onPeek)
    return () => window.removeEventListener(PEEK_EVENT, onPeek)
  }, [])

  // ---- Stanchezza serale: si ricalcola ogni minuto ----
  useEffect(() => {
    const update = () => setTired(tirednessAt(new Date(), settings))
    update()
    const id = window.setInterval(update, 60_000)
    return () => window.clearInterval(id)
  }, [settings.dndEnabled, settings.dndFrom])

  // Tardi la sera, se lavori ancora, ogni tanto sbadiglia.
  const sleepy = formed && mood === 'normal' && anim === 'normal' && !reducedMotion
  useEffect(() => {
    if (!sleepy || tired !== 'late' || yawning) return
    const id = window.setTimeout(() => setYawning(true), 25_000 + Math.random() * 45_000)
    return () => window.clearTimeout(id)
  }, [sleepy, tired, yawning])
  useEffect(() => {
    const onYawn = () => setYawning(true)
    window.addEventListener(YAWN_EVENT, onYawn)
    return () => window.removeEventListener(YAWN_EVENT, onYawn)
  }, [])

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

  const toggle = () => (panelOpen ? window.pix.closePanel() : window.pix.openPanel())
  const color = moodColor(mood, settings.pixColor)

  const face = faceTransform(scale, shape)

  return (
    <div
      className="mascot"
      style={{ ['--pix-color' as string]: color }}
      data-anim={anim}
      data-yawn={yawning && formed && !reducedMotion ? '' : undefined}
      data-hungry={hungry && formed ? '' : undefined}
      data-swallow={formed && swallowPhase ? swallowPhase : undefined}
    >
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
            <g
              className="yawn-body"
              onAnimationEnd={(e) => {
                if (e.animationName === 'pix-yawn-body') setYawning(false)
              }}
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
                    <g className={`lids ${formed && mood === 'normal' && tired !== 'none' ? `lids-${tired}` : ''}`}>
                      <g className={`eyes ${blink ? 'blink' : ''}`}>
                        <Eyes mood={formed ? (swallowPhase === 'chew' ? 'happy' : mood) : 'normal'} style={settings.pixEyes} />
                      </g>
                    </g>
                  </g>
                </g>
                {/* Scadenze vicine: sopracciglia preoccupate e una goccia di sudore */}
                {formed && mood === 'normal' && mascot.tension && (
                  <g className="tense">
                    <path d="M36 41.5 L45.5 37.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
                    <path d="M64 41.5 L54.5 37.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
                    <path d="M80 26 C77 31 76.5 34 80 35.5 C83.5 34 83 31 80 26 Z" fill="#8fd3ff" stroke="#fff" strokeWidth="1" />
                  </g>
                )}
                <ellipse className="yawn-mouth" cx="50" cy="69" rx="5.5" ry="7" fill="#000" opacity="0" />
              </g>
            </g>
          </g>
        </g>
        {/* Ciò che hai trascinato vola nella bocca di Pix */}
        {swallow && formed && swallowPhase === 'open' && <SwallowItem key={swallow.id} kind={swallow.kind} from={swallow.from} to={mouthPoint(scale, shape)} />}
        {/* Occhi della sbirciata: il corpo è la barra stessa (setBar). */}
        {peek !== null && canPeek && (
          <Peek
            y={peek.y}
            scareRef={scareRef}
            scale={scale}
            shape={shape}
            eyes={settings.pixEyes}
            shine={settings.pixShine}
            setBar={(d) => morph.current?.setBar(d)}
            onDone={() => setPeek(null)}
          />
        )}
        {formed && (
          <g transform={face} pointerEvents="none">
            <Badge mood={mood} />
          </g>
        )}
      </svg>
    </div>
  )
}
