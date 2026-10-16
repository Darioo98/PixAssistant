import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MASCOT_SCALE, NIGHT, SECTION_ANIMATIONS, eyeColorFor, moodColor, moodTransform, pickTransform, type MascotState, type PixTransform } from '@shared/mascot'
import type { Settings } from '@shared/settings'
import { MorphController } from './morph'
import { PIX_ANCHOR, VIEW, faceTransform, mouthPoint } from './geometry'
import { Badge, Eyes, PixFill, Shine } from './Faces'
import { BubbleCard } from './BubbleCard'
import { Peek } from './Peek'
import { SwallowItem, type SwallowLook } from './SwallowItem'
import { SWALLOW_S } from './shapes'
import { DELETED_EVENT, type DeletedDetail } from './SweepDrop'
import { BOOT_FILL_S, bootBarPath, tubeOutline } from './bootFill'
import { useSlosh } from './useSlosh'
import { weatherKind } from '@shared/extras'
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
/** Prova del meteo sul corpo (dettaglio: 'rain' | 'sun' | 'cold'). */
export const WEATHER_FX_EVENT = 'pix:weather-fx'
/** Prova del riempimento della barra all'avvio (chiude il pannello). */
export const BOOT_EVENT = 'pix:boot'

type WeatherFx = 'rain' | 'sun' | 'cold' | null

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
  /** Avvio con Windows: la barra si riempie dal basso prima che Pix si svegli. */
  boot?: boolean
}

/**
 * Barra laterale e Pix sono la stessa forma: un tracciato SVG che si
 * trasforma (barra → goccia → squircle) e torna indietro. Da chiusa resta
 * solo la barra, senza animazioni attive.
 */
export function Mascot({ mascot, panelOpen, tab, settings, boot = false }: Props) {
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
  const [swallow, setSwallow] = useState<{ id: number; look: SwallowLook; from: { x: number; y: number }; payload: DropPayload | null } | null>(null)
  /** Fasi dell'inghiottire: bocca spalancata mentre arriva il boccone, poi mastica. */
  const [swallowPhase, setSwallowPhase] = useState<'open' | 'chew' | null>(null)
  const [tired, setTired] = useState<Tired>(() => tirednessAt(new Date(), settings))
  const lastTransform = useRef<PixTransform | null>(null)
  /** Trascinamento della barra in corso. */
  const barDrag = useRef<{ startY: number; startLift: number; lift: number; moved: boolean; raf: number } | null>(null)
  const draggingBar = useRef(false)
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
      // Mentre trascini la barra Pix non si forma.
      if (now && draggingBar.current) return
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
      const payload = { paths, text }
      const id = performance.now()
      if (paths.length) {
        // L'icona vera del file (quella di Esplora file); se non arriva subito, il nome su un foglietto.
        const name = Array.from(dt.files)[0]?.name ?? paths[0]!
        const fallback = window.setTimeout(() => setSwallow((s) => s ?? { id, look: { text: name }, from, payload }), 300)
        void window.pix.fileIcon(paths[0]!).then((icon) => {
          window.clearTimeout(fallback)
          setSwallow((s) => s ?? { id, look: icon ? { icon } : { text: name }, from, payload })
        })
      } else {
        const site = /^\s*(https?:\/\/|www\.)\S+\s*$/i.test(text) ? text.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0]! : null
        setSwallow({ id, look: site ? { site } : { text }, from, payload })
      }
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
    const onTry = () => setSwallow({ id: performance.now(), look: { text: t('settings.trySwallowText') }, from: { x: 92, y: 110 }, payload: null })
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

  // ---- Liquido nel bicchiere: mentre scorri una lista Pix si inclina e poi oscilla ----
  const sloshRef = useRef<SVGGElement>(null)
  useSlosh(sloshRef, formed && panelOpen && anim === 'normal' && !reducedMotion, scale)

  // ---- Sonno più vivo: si affloscia, respira piano e ogni tanto si gira dall'altra parte ----
  const [sleepSide, setSleepSide] = useState<1 | -1>(1)
  const [turning, setTurning] = useState(false)
  const sleeping = formed && mood === 'sleep' && anim !== 'off' && !reducedMotion
  useEffect(() => {
    if (!sleeping) return
    let id: number
    let end: number
    const schedule = (first: boolean) => {
      id = window.setTimeout(
        () => {
          setTurning(true)
          setSleepSide((s) => (s === 1 ? -1 : 1))
          end = window.setTimeout(() => setTurning(false), 900)
          schedule(false)
        },
        first ? 2500 : 18_000 + Math.random() * 17_000
      )
    }
    schedule(true)
    return () => {
      window.clearTimeout(id)
      window.clearTimeout(end)
    }
  }, [sleeping])

  // ---- Meteo sul corpo: pioggia sulla testa, riflesso col sole, brividi col freddo ----
  const [weatherFx, setWeatherFx] = useState<WeatherFx>(null)
  const [weatherPreview, setWeatherPreview] = useState<WeatherFx>(null)
  useEffect(() => {
    let alive = true
    const load = () =>
      void window.pix.weather().then((w) => {
        if (!alive) return
        if (w.status !== 'ok') return setWeatherFx(null)
        const kind = weatherKind(w.weather.code)
        if (kind === 'rain' || kind === 'drizzle' || kind === 'showers' || kind === 'storm') setWeatherFx('rain')
        else if (kind === 'snow' || w.weather.temperature < 6) setWeatherFx('cold')
        else if (kind === 'clear' && w.weather.isDay) setWeatherFx('sun')
        else setWeatherFx(null)
      })
    load()
    const id = window.setInterval(load, 20 * 60_000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [settings.weatherCity])
  useEffect(() => {
    let end: number | undefined
    const onTry = (e: Event) => {
      setWeatherPreview((e as CustomEvent<WeatherFx>).detail)
      window.clearTimeout(end)
      end = window.setTimeout(() => setWeatherPreview(null), 15_000)
    }
    window.addEventListener(WEATHER_FX_EVENT, onTry)
    return () => {
      window.clearTimeout(end)
      window.removeEventListener(WEATHER_FX_EVENT, onTry)
    }
  }, [])
  const fx = formed && mood === 'normal' && anim !== 'off' && !reducedMotion ? (weatherPreview ?? weatherFx) : null
  const [rainKey, setRainKey] = useState(0)
  /** Freddo: nuvolette di vapore dal respiro. Sole: occhiali da sole che scendono sugli occhi. */
  const [puffKey, setPuffKey] = useState(0)
  const [shades, setShades] = useState(false)
  useEffect(() => {
    if (!fx) {
      setShades(false)
      return
    }
    let id: number
    let end: number
    const schedule = (first: boolean) => {
      id = window.setTimeout(
        () => {
          if (fx === 'rain') setRainKey((k) => k + 1)
          else if (fx === 'cold') setPuffKey((k) => k + 1)
          else {
            setShades(true)
            end = window.setTimeout(() => setShades(false), 4500)
          }
          schedule(false)
        },
        first ? 900 : fx === 'rain' ? 6000 + Math.random() * 6000 : fx === 'cold' ? 4500 + Math.random() * 3500 : 12_000 + Math.random() * 8000
      )
    }
    schedule(true)
    return () => {
      window.clearTimeout(id)
      window.clearTimeout(end)
    }
  }, [fx])

  // ---- Fumetto: nasce come una bolla dalla testa, e Pix fa un piccolo sussulto ----
  const [pop, setPop] = useState(false)
  useEffect(() => {
    if (!bubble) return
    setPop(true)
    const id = window.setTimeout(() => setPop(false), 500)
    return () => window.clearTimeout(id)
  }, [bubble?.id])

  // ---- Fine del turno: si stira, fa un inchino e saluta ----
  const [farewell, setFarewell] = useState(false)
  const gestureAt = mascot.gesture?.at
  useEffect(() => {
    if (!gestureAt || reducedMotion) return
    setFarewell(true)
    const id = window.setTimeout(() => setFarewell(false), 3600)
    return () => window.clearTimeout(id)
  }, [gestureAt])

  // ---- Eliminazione: Pix si mangia ciò che hai eliminato (come quando gli trascini un file) ----
  useEffect(() => {
    const onDeleted = (e: Event) => {
      const at = (e as CustomEvent<DeletedDetail | null>).detail
      const r = svgRef.current?.getBoundingClientRect()
      if (!at || !r || reducedMotion || anim === 'off') return
      const from = { x: ((at.x - r.left) / r.width) * VIEW.width, y: ((at.y - r.top) / r.height) * VIEW.height }
      setSwallow((cur) => cur ?? { id: performance.now(), look: { text: at.text || '…' }, from, payload: null })
    }
    window.addEventListener(DELETED_EVENT, onDeleted)
    return () => window.removeEventListener(DELETED_EVENT, onDeleted)
  }, [reducedMotion, anim])

  // ---- Avvio con Windows: la barra si riempie dal basso come un tubo, poi Pix si sveglia ----
  const [booting, setBooting] = useState(false)
  const bootDone = useRef(false)
  const runBoot = () => {
    if (reducedMotion) return
    setBooting(true)
    const start = performance.now()
    const step = (now: number) => {
      const t = (now - start) / 1000
      const k = Math.min(1, t / BOOT_FILL_S)
      // Sale svelto all'inizio e rallenta verso la cima, con un piccolo assestamento.
      const fill = 1 - (1 - k) ** 2.4
      if (t < BOOT_FILL_S + 0.7) {
        morph.current?.setBar(bootBarPath(fill, t))
        requestAnimationFrame(step)
      } else {
        morph.current?.setBar(null)
        setBooting(false)
      }
    }
    morph.current?.setBar('')
    requestAnimationFrame(step)
  }
  useLayoutEffect(() => {
    if (!boot || bootDone.current) return
    bootDone.current = true
    runBoot()
  }, [boot])
  const [bootSoon, setBootSoon] = useState(false)
  useEffect(() => {
    const onTry = () => {
      setBootSoon(true)
      window.pix.closePanel()
    }
    window.addEventListener(BOOT_EVENT, onTry)
    return () => window.removeEventListener(BOOT_EVENT, onTry)
  }, [])
  useEffect(() => {
    if (!bootSoon || !collapsed || wantPix) return
    const id = window.setTimeout(() => {
      setBootSoon(false)
      runBoot()
    }, 600)
    return () => window.clearTimeout(id)
  }, [bootSoon, collapsed, wantPix])

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

  const toggle = () => {
    // Al termine di un trascinamento della barra il clic non apre il pannello.
    if (barDrag.current?.moved) return
    if (panelOpen) window.pix.closePanel()
    else window.pix.openPanel()
  }

  // ---- Barra spostabile: trascinandola su e giù lungo il bordo dello schermo ----
  const onBarPointerDown = (e: React.PointerEvent<SVGElement>) => {
    // Si sposta solo a pannello chiuso (barra o Pix appena formato al passaggio del mouse).
    if (e.button !== 0 || panelOpen) return
    e.currentTarget.setPointerCapture(e.pointerId)
    barDrag.current = { startY: e.screenY, startLift: settings.barLift, lift: settings.barLift, moved: false, raf: 0 }
  }
  const onBarPointerMove = (e: React.PointerEvent<SVGElement>) => {
    const d = barDrag.current
    if (!d) return
    const dy = e.screenY - d.startY
    if (!d.moved && Math.abs(dy) < 5) return
    if (!d.moved) {
      d.moved = true
      draggingBar.current = true
      setHovered(false)
    }
    d.lift = Math.max(0, d.startLift - dy)
    if (!d.raf) {
      d.raf = requestAnimationFrame(() => {
        d.raf = 0
        void window.pix.moveBar(d.lift, false)
      })
    }
  }
  const onBarPointerUp = (e: React.PointerEvent<SVGElement>) => {
    const d = barDrag.current
    if (!d) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (d.moved) void window.pix.moveBar(d.lift, true)
    draggingBar.current = false
    // Il clic arriva subito dopo: lo si lascia passare solo se non c'è stato trascinamento.
    window.setTimeout(() => (barDrag.current = null), 0)
  }
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
      data-weather={fx ?? undefined}
      data-shades={shades && fx === 'sun' ? '' : undefined}
      data-pop={pop && formed ? '' : undefined}
      data-farewell={farewell && formed ? '' : undefined}
      data-turning={turning && sleeping ? '' : undefined}
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
            onPointerDown={onBarPointerDown}
            onPointerMove={onBarPointerMove}
            onPointerUp={onBarPointerUp}
            onPointerCancel={onBarPointerUp}
          />
        )}
        <ellipse ref={shadowRef} cx={PIX_ANCHOR.x} cy={PIX_ANCHOR.y + 6} rx={24 * scale} ry="3" fill="#000" opacity="0" />
        {/* Avvio: il tubo vuoto che si riempie */}
        {booting && <path className="boot-tube" d={tubeOutline()} fill="none" stroke={color} strokeWidth="1.2" />}
        <g ref={sloshRef}>
        <g className={`pose ${formed ? `pose-${mood}` : ''} ${sleeping && sleepSide === -1 ? 'side-left' : ''}`}>
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
                onPointerDown={onBarPointerDown}
                onPointerMove={onBarPointerMove}
                onPointerUp={onBarPointerUp}
                onPointerCancel={onBarPointerUp}
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
                {/* Sole: un luccichio sul riflesso */}
                {fx === 'sun' && settings.pixShine && <path className="sparkle" d="M27 20l1.4 3.6 3.6 1.4-3.6 1.4L27 30l-1.4-3.6-3.6-1.4 3.6-1.4z" fill="#fff" />}
                {/* Sole: occhiali scuri che ogni tanto scendono sugli occhi */}
                {fx === 'sun' && (
                  <g className="shades">
                    <path d="M31 45h15a3 3 0 0 1 3 3v2.5a7.5 7.5 0 0 1-7.5 7.5h-3A7.5 7.5 0 0 1 31 50.5V48a3 3 0 0 1 3-3z" fill="#1f2033" />
                    <path d="M54 45h15a3 3 0 0 1 3 3v2.5a7.5 7.5 0 0 1-7.5 7.5h-3A7.5 7.5 0 0 1 54 50.5V48a3 3 0 0 1 3-3z" transform="translate(-3 0)" fill="#1f2033" />
                    <path d="M49 48.5q2.5-2 5 0" stroke="#1f2033" strokeWidth="2.2" fill="none" strokeLinecap="round" />
                    <path d="M35 48.5l4-0.5M58 48.5l4-0.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity=".55" />
                  </g>
                )}
                {/* Freddo: nuvoletta di vapore dal respiro */}
                {fx === 'cold' && puffKey > 0 && (
                  <g key={puffKey} className="puff" fill="#fff">
                    <circle cx="47" cy="70" r="2.4" />
                    <circle cx="42" cy="68.5" r="3.2" />
                    <circle cx="37" cy="69.5" r="2.7" />
                  </g>
                )}
              </g>
            </g>
          </g>
        </g>
        </g>
        {/* Pioggia: una goccia cade sulla testa e schizza */}
        {fx === 'rain' && rainKey > 0 && (
          <g key={rainKey} className="rain" transform={`translate(${PIX_ANCHOR.x + 9 * scale} ${PIX_ANCHOR.y - 64 * scale})`} pointerEvents="none">
            <path className="rain-drop" d="M0 -9 C2.4 -5 3.4 -3 3.4 -1.4 A3.4 3.4 0 0 1 -3.4 -1.4 C-3.4 -3 -2.4 -5 0 -9 Z" fill="#8fd3ff" stroke="#fff" strokeWidth="0.8" />
            <g className="rain-splash" fill="#8fd3ff">
              <circle cx="-5" cy="-2" r="1.3" />
              <circle cx="5" cy="-2.5" r="1.1" />
              <circle cx="0" cy="-4" r="0.9" />
            </g>
          </g>
        )}

        {/* Ciò che hai trascinato vola nella bocca di Pix */}
        {swallow && formed && swallowPhase === 'open' && <SwallowItem key={swallow.id} look={swallow.look} from={swallow.from} to={mouthPoint(scale, shape)} />}
        {/* Occhi della sbirciata: il corpo è la barra stessa (setBar). */}
        {peek !== null && canPeek && !booting && (
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
