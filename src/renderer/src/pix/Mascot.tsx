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
import { ANIM_S, HEAT_S, playSeconds, SHIVER_S, SWALLOW_S, TRASH_S, grabShape, heatShape, shiverShape, trashShape } from './shapes'
import { stretchedBarPath } from './bootFill'
import { DELETED_EVENT, type DeletedDetail } from './SweepDrop'
import { BOOT_FILL_S, bootBarPath, tubeOutline } from './bootFill'
import { useSlosh } from './useSlosh'
import { BodyTint, SoftLight, SunDefs, SunFace } from './SunFx'
import { MeltDrops } from './MeltDrops'
import { runHourglassEyes } from './hourglassEyes'
import { Director, type Act } from './director'
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
/** Prova del meteo sul corpo (dettaglio: 'rain' | 'sun' | 'cold' | 'hot'). */
export const WEATHER_FX_EVENT = 'pix:weather-fx'
/** Prova del riempimento della barra all'avvio (chiude il pannello). */
export const BOOT_EVENT = 'pix:boot'

type WeatherFx = 'rain' | 'sun' | 'cold' | 'hot' | null

/** Gocce di pioggia: spostamento orizzontale, ritardo (s) e dimensione. */
const RAIN_DROPS: Array<[number, number, number]> = [
  [-16, 0, 0.85],
  [-5, 0.3, 1],
  [7, 0.12, 0.9],
  [17, 0.55, 0.8],
  [1, 0.85, 1.05],
  [-11, 1.1, 0.9],
  [12, 1.4, 0.95],
  [-19, 1.7, 0.8],
  [3, 2.0, 1],
  [-8, 2.3, 0.85],
  [15, 2.55, 0.9],
  [-2, 2.85, 1]
]

/** Da quanti gradi Pix sente caldo e si affloscia. */
const HOT_FROM = 27

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
  const barDrag = useRef<{ startY: number; startX: number; startLift: number; lift: number; moved: boolean; raf: number; pix: boolean } | null>(null)
  const draggingBar = useRef(false)
  /** Sbirciata in corso e funzione che la spaventa. */
  const peekActive = useRef(false)
  const scareRef = useRef<(() => void) | null>(null)

  /** Pix afferrato dal puntatore: lo segue come un fluido, spaventato. */
  const [grabbed, setGrabbed] = useState(false)

  const wantPix = panelOpen || hovered || bubble !== null || mascot.spotlight || hungry || swallow !== null || grabbed

  // ---- Regista: una sola animazione alla volta (vedi director.ts) ----
  const [act, setAct] = useState<Act | null>(null)
  const interruptRef = useRef<(a: Act) => void>(() => {})
  const director = useRef<Director | null>(null)
  director.current ??= new Director(setAct, (a) => interruptRef.current(a))
  useEffect(() => () => director.current?.dispose(), [])
  const claim = (a: Act, ms: number) => (reducedMotion ? null : (director.current?.claim(a, ms) ?? null))
  const release = (token: number | null) => director.current?.release(token)

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
    const token = claim('swallow', SWALLOW_S.total * 1000 + 100)
    setSwallowPhase('open')
    const started = morph.current?.swallow() ?? false
    const timers = [
      window.setTimeout(() => setSwallowPhase('chew'), SWALLOW_S.bite * 1000),
      window.setTimeout(() => setSwallowPhase(null), SWALLOW_S.chewEnd * 1000),
      window.setTimeout(() => sendDrop(swallow), (started ? SWALLOW_S.total : SWALLOW_S.bite + 0.3) * 1000)
    ]
    return () => {
      timers.forEach((t) => window.clearTimeout(t))
      release(token)
    }
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
  const PLAY_MS = ANIM_S * 1000 + 100
  /** "Si scioglie" in corso: dalle colate si staccano gocce che cadono. */
  const [meltDrops, setMeltDrops] = useState(0)
  /** Clessidra in corso: Pix è la clessidra e i suoi occhi sono i chicchi che scendono. */
  const [hourglassAt, setHourglassAt] = useState(0)
  const play = (kind: PixTransform, loop = false, as: Act = 'spontaneous') => {
    if (reducedMotion) return null
    const token = claim(as, loop ? 10 * 60_000 : playSeconds(kind) * 1000 + 100)
    if (token === null) return null
    lastTransform.current = kind
    morph.current?.start(kind, loop)
    setMeltDrops(kind === 'melt' ? performance.now() : 0)
    setHourglassAt(kind === 'hourglass' ? performance.now() : 0)
    return token
  }
  useEffect(() => {
    if (!hourglassAt) return
    const id = window.setTimeout(() => setHourglassAt(0), playSeconds('hourglass') * 1000 + 100)
    return () => window.clearTimeout(id)
  }, [hourglassAt])
  const eyesRef = useRef<SVGGElement>(null)
  const flipRef = useRef<SVGGElement>(null)
  useEffect(() => {
    if (!meltDrops) return
    const id = window.setTimeout(() => setMeltDrops(0), PLAY_MS)
    return () => window.clearTimeout(id)
  }, [meltDrops])

  // Animazioni spontanee, ogni tanto, solo se Pix è visibile e sveglio.
  const [spontaneousTick, setSpontaneousTick] = useState(0)
  useEffect(() => {
    if (!formed || anim !== 'normal' || !settings.pixTransforms || mood !== 'normal' || reducedMotion) return
    const id = window.setTimeout(() => {
      play(pickTransform(lastTransform.current, Math.random), false, 'spontaneous')
      setSpontaneousTick((n) => n + 1)
    }, 35_000 + Math.random() * 35_000)
    return () => window.clearTimeout(id)
  }, [formed, anim, settings.pixTransforms, mood, reducedMotion, spontaneousTick])

  // Animazioni legate allo stato (antenne mentre pensa, cuore che batte quando festeggia):
  // durano finché dura lo stato.
  const moodAnim = formed && !reducedMotion ? moodTransform(mood) : null
  // Riparte quando il palco si libera (es. dopo un'animazione più importante).
  const moodStage = act === null || act === 'mood'
  useEffect(() => {
    if (!moodAnim || !moodStage) return
    const token = play(moodAnim, true, 'mood')
    if (token === null) return
    return () => {
      morph.current?.stopPlay()
      release(token)
    }
  }, [moodAnim, moodStage])

  // Ogni sezione del pannello ha la sua animazione di benvenuto.
  useEffect(() => {
    if (!panelOpen || anim === 'off') return
    const kind = SECTION_ANIMATIONS[tab]
    if (kind) play(kind, false, 'section')
  }, [tab, panelOpen, anim])

  // Prova dalle impostazioni ("Prova le animazioni").
  useEffect(() => {
    const onPreview = (e: Event) => play((e as CustomEvent<PixTransform>).detail, false, 'preview')
    window.addEventListener(TRANSFORM_EVENT, onPreview)
    return () => window.removeEventListener(TRANSFORM_EVENT, onPreview)
  }, [reducedMotion])

  // ---- Sbirciata: a pannello chiuso ogni tanto un piccolo Pix sbuca da dietro la barra ----
  const [peek, setPeek] = useState<{ y: number } | null>(null)
  const [peekSoon, setPeekSoon] = useState(false)
  // La sbirciata dipende solo dal livello delle animazioni (non dall'interruttore delle trasformazioni del corpo).
  const canPeek = collapsed && !wantPix && anim === 'normal' && !reducedMotion && mood !== 'sleep'
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
    const id = window.setTimeout(() => claim('yawn', 2500) !== null && setYawning(true), 25_000 + Math.random() * 45_000)
    return () => window.clearTimeout(id)
  }, [sleepy, tired, yawning])
  useEffect(() => {
    const onYawn = () => claim('preview', 2500) !== null && setYawning(true)
    window.addEventListener(YAWN_EVENT, onYawn)
    return () => window.removeEventListener(YAWN_EVENT, onYawn)
  }, [])

  // ---- Liquido nel bicchiere: mentre scorri una lista Pix si inclina e poi oscilla ----
  useSlosh(formed && panelOpen && anim === 'normal' && !reducedMotion, (a, t) => morph.current?.slosh(a, t))

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
          if (claim('turn', 950) === null) return schedule(false)
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
  /** Ogni clic su "prova" fa ripartire l'episodio, anche se il meteo è lo stesso di prima. */
  const [weatherTry, setWeatherTry] = useState(0)
  useEffect(() => {
    let alive = true
    const load = () =>
      void window.pix.weather().then((w) => {
        if (!alive) return
        if (w.status !== 'ok') return setWeatherFx(null)
        const kind = weatherKind(w.weather.code)
        if (kind === 'rain' || kind === 'drizzle' || kind === 'showers' || kind === 'storm') setWeatherFx('rain')
        else if (kind === 'snow' || w.weather.temperature < 6) setWeatherFx('cold')
        else if (w.weather.temperature >= HOT_FROM) setWeatherFx('hot')
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
      setWeatherTry((n) => n + 1)
      window.clearTimeout(end)
      end = window.setTimeout(() => {
        setWeatherPreview(null)
        setWeatherTry(0)
      }, 15_000)
    }
    window.addEventListener(WEATHER_FX_EVENT, onTry)
    return () => {
      window.clearTimeout(end)
      window.removeEventListener(WEATHER_FX_EVENT, onTry)
    }
  }, [])
  const fxOn = formed && mood === 'normal' && anim !== 'off' && !reducedMotion ? (weatherPreview ?? weatherFx) : null
  /** Gli elementi del meteo (raggio, neve, broncio…) non si sovrappongono ad altre animazioni. */
  const fx = act === null || act === 'weather' || act === 'weatherTry' ? fxOn : null
  const [rainKey, setRainKey] = useState(0)
  const [wince, setWince] = useState(false)
  useEffect(() => {
    if (!rainKey) return
    const a = window.setTimeout(() => setWince(true), 650)
    const b = window.setTimeout(() => setWince(false), 1300)
    return () => {
      window.clearTimeout(a)
      window.clearTimeout(b)
    }
  }, [rainKey])
  /** Episodio di meteo in corso: solo durante questo si vedono raggio, neve, pioggia, vapore… */
  const [episode, setEpisode] = useState<WeatherFx>(null)
  /** Ciò che si vede del meteo: solo durante l'episodio (tutto con la stessa durata). */
  const ep = act === 'weather' || act === 'weatherTry' ? episode : null
  const [shivering, setShivering] = useState(false)
  const [melting, setMelting] = useState(false)
  useEffect(() => {
    if (!fxOn) return
    const fx = fxOn
    let id: number
    let end: number
    let episodeEnd: number
    // Provato dalle impostazioni: parte subito e, se Pix è occupato, riprova a breve.
    let trying = weatherTry > 0
    let retries = 0
    /** Episodio in corso (il suo gettone): se si riparte, va fermato subito. */
    let playing: number | null = null
    const retry = () => {
      if (retries++ < 20) {
        id = window.setTimeout(run, 250)
        return true
      }
      return false
    }
    const run = () => {
      const ms = ANIM_S * 1000
      const token = claim(trying ? 'weatherTry' : 'weather', ms)
      // Se c'è già un'altra animazione, il meteo aspetta il prossimo giro.
      if (token === null) return trying && retry() ? undefined : schedule(false)
      // Freddo e caldo muovono il corpo: se sta ancora finendo un altro movimento si riprova.
      const body = fx === 'cold' ? morph.current?.perform(shiverShape, SHIVER_S) : fx === 'hot' ? morph.current?.perform(heatShape, HEAT_S) : true
      if (!body) {
        release(token)
        return retry() ? undefined : schedule(false)
      }
      trying = false
      retries = 0
      // Un episodio: corpo, raggio, neve, pioggia… partono e finiscono insieme.
      setEpisode(fx)
      playing = token
      episodeEnd = window.setTimeout(() => {
        setEpisode(null)
        playing = null
      }, ms)
      if (fx === 'rain') setRainKey((k) => k + 1)
      else if (fx === 'cold') {
        setShivering(true)
        end = window.setTimeout(() => setShivering(false), SHIVER_S * 1000)
      } else if (fx === 'hot') {
        setMelting(true)
        end = window.setTimeout(() => setMelting(false), HEAT_S * 1000)
      }
      schedule(false)
    }
    const schedule = (first: boolean) => {
      id = window.setTimeout(
        run,
        first ? (trying ? 120 : 900) : ANIM_S * 1000 + (fx === 'rain' ? 5000 + Math.random() * 5000 : fx === 'hot' ? 18_000 + Math.random() * 12_000 : 9000 + Math.random() * 8000)
      )
    }
    schedule(true)
    return () => {
      window.clearTimeout(id)
      window.clearTimeout(end)
      window.clearTimeout(episodeEnd)
      // Un nuovo clic su "prova" (o il meteo che cambia) ferma l'episodio in corso, corpo compreso.
      if (playing !== null && (fx === 'cold' || fx === 'hot')) morph.current?.interrupt()
      release(playing)
      setShivering(false)
      setMelting(false)
      setEpisode(null)
    }
  }, [fxOn, weatherTry])

  // ---- Fumetto: nasce come una bolla dalla testa, e Pix fa un piccolo sussulto ----
  const [pop, setPop] = useState(false)
  useEffect(() => {
    if (!bubble || claim('pop', 500) === null) return
    setPop(true)
    const id = window.setTimeout(() => setPop(false), 500)
    return () => window.clearTimeout(id)
  }, [bubble?.id])

  // ---- Fine del turno: si stira, fa un inchino e saluta ----
  const [farewell, setFarewell] = useState(false)
  const gestureAt = mascot.gesture?.at
  useEffect(() => {
    if (!gestureAt || reducedMotion || claim('farewell', 3600) === null) return
    setFarewell(true)
    const id = window.setTimeout(() => setFarewell(false), 3600)
    return () => window.clearTimeout(id)
  }, [gestureAt])

  // ---- Eliminazione: Pix si trasforma in un cestino, la cosa eliminata ci cade dentro e il coperchio sbatte ----
  const [trash, setTrash] = useState<{ id: number; look: SwallowLook; from: { x: number; y: number } } | null>(null)
  useEffect(() => {
    let end: number | undefined
    const onDeleted = (e: Event) => {
      const at = (e as CustomEvent<DeletedDetail | null>).detail
      const r = svgRef.current?.getBoundingClientRect()
      if (!at || !r || reducedMotion || anim === 'off') return
      if (claim('trash', TRASH_S.total * 1000 + 80) === null) return
      if (!morph.current?.perform(trashShape, TRASH_S.total)) return
      const from = { x: ((at.x - r.left) / r.width) * VIEW.width, y: ((at.y - r.top) / r.height) * VIEW.height }
      setTrash({ id: performance.now(), look: { text: at.text || '…' }, from })
      window.clearTimeout(end)
      end = window.setTimeout(() => setTrash(null), TRASH_S.total * 1000 + 60)
    }
    window.addEventListener(DELETED_EVENT, onDeleted)
    return () => {
      window.clearTimeout(end)
      window.removeEventListener(DELETED_EVENT, onDeleted)
    }
  }, [reducedMotion, anim])

  // Quando il regista interrompe un'animazione, si ferma tutto ciò che la riguarda.
  interruptRef.current = (a: Act) => {
    morph.current?.interrupt()
    if (a === 'yawn' || a === 'preview') setYawning(false)
    if (a === 'weather' || a === 'weatherTry') {
      setEpisode(null)
      setShivering(false)
      setMelting(false)
    }
    if (a === 'pop') setPop(false)
    if (a === 'farewell') setFarewell(false)
    if (a === 'turn') setTurning(false)
    if (a === 'trash') setTrash(null)
  }

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

  // ---- Clessidra: gli occhi cadono davvero, con la gravità, e la clessidra si capovolge ----
  const hourglassOn = hourglassAt > 0 && formed && (act === 'section' || act === 'spontaneous' || act === 'preview')
  useEffect(() => {
    const eyes = eyesRef.current
    const flip = flipRef.current
    if (!hourglassOn || !eyes || !flip) return
    return runHourglassEyes({ start: hourglassAt, eyes, flip, scale, shape })
  }, [hourglassOn, hourglassAt, scale, shape])

  // ---- Occhi che seguono il cursore quando è vicino (dentro la finestra) ----
  const follow = formed && !hourglassOn && settings.eyesFollowCursor && anim !== 'off' && (mood === 'normal' || mood === 'greet')
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
  /** Molla della barra trascinata: allungamento (px) e sua velocità. */
  const barSpring = useRef({ s: 0, v: 0, target: 0, raf: 0, last: 0, t0: 0, lastLift: 0, lastAt: 0 })
  const runBarSpring = () => {
    const sp = barSpring.current
    if (sp.raf) return
    const step = (now: number) => {
      const dt = sp.last ? Math.min(0.033, (now - sp.last) / 1000) : 1 / 60
      sp.last = now
      if (!sp.t0) sp.t0 = now
      // Il bersaglio si spegne da solo quando smetti di muovere.
      sp.target *= Math.exp(-dt * 6)
      // Smorzamento critico: la barra si allunga e torna senza rimbalzare, come un liquido.
      sp.v += ((sp.target - sp.s) * 160 - sp.v * 25) * dt
      sp.s += sp.v * dt
      const t = (now - sp.t0) / 1000
      if (!draggingBar.current && Math.abs(sp.s) < 0.15 && Math.abs(sp.v) < 0.5) {
        morph.current?.setBar(null)
        sp.raf = 0
        sp.last = 0
        sp.t0 = 0
        return
      }
      morph.current?.setBar(stretchedBarPath(sp.s, t))
      sp.raf = requestAnimationFrame(step)
    }
    sp.raf = requestAnimationFrame(step)
  }

  /**
   * Pix afferrato: segue il cursore con un po' di ritardo (come un liquido),
   * si allunga nel verso del movimento e trema dalla paura. Lasciato andare,
   * la barra si sposta a quell'altezza e Pix scivola di nuovo contro il bordo.
   */
  const grabRef = useRef<SVGGElement>(null)
  /**
   * Stato della presa. In verticale si muove la finestra (come la barra), così
   * Pix arriva fino in fondo e fino in cima; dentro, Pix resta un po' indietro
   * (`ly` insegue la posizione vera) e in orizzontale insegue il cursore (`x`).
   * Il dondolio (`swing`) è un pendolo appeso alla cima.
   */
  const grabState = useRef({
    x: 0,
    vx: 0,
    tx: 0,
    ly: 0,
    vly: 0,
    lift: 0,
    swing: 0,
    vswing: 0,
    raf: 0,
    last: 0,
    released: false,
    token: null as number | null,
    t0: 0,
    releaseAt: 0,
    /** Istante in cui ha toccato la parete e si schiaccia fino a diventare barra. */
    squashAt: 0
  })
  const runGrab = () => {
    const g = grabState.current
    if (g.raf) return
    const step = (now: number) => {
      const dt = g.last ? Math.min(0.033, (now - g.last) / 1000) : 1 / 60
      g.last = now
      // Come un liquido: segue con un leggero ritardo e si ferma morbido, senza rimbalzi (smorzamento critico).
      g.vx += ((g.tx - g.x) * 90 - g.vx * 19) * dt
      g.x += g.vx * dt
      g.vly += ((g.lift - g.ly) * 100 - g.vly * 20) * dt
      g.ly += g.vly * dt
      const lagY = g.lift - g.ly // > 0: la finestra è salita e Pix resta indietro (più in basso)
      // Si inclina appena contro il movimento e torna dritto senza dondolare.
      const swingTarget = Math.max(-18, Math.min(18, -g.vx * 0.03))
      g.swing += (swingTarget - g.swing) * (1 - Math.exp(-dt * 9))
      const stretch = Math.min(0.22, Math.abs(g.vly) * 0.0009 + Math.abs(lagY) * 0.004)
      const px = PIX_ANCHOR.x
      const py = PIX_ANCHOR.y - 70 * scale
      // Lasciato andare: scivola contro la parete e ci si schiaccia fino a diventare la barra.
      const wallX = VIEW.width - PIX_ANCHOR.x - 30 * scale
      if (g.released && !g.squashAt && g.x > wallX - 1.5) g.squashAt = now
      if (g.squashAt) {
        const k = Math.min(1, (now - g.squashAt) / 300)
        const e = k * k * (3 - 2 * k)
        // Da Pix (60×66) alla barra (8×180), appoggiato alla parete.
        const sx = 1 + (8 / (60 * scale) - 1) * e
        const sy = 1 + (180 / (66 * scale) - 1) * e * e
        const cy = PIX_ANCHOR.y - 33 * scale
        const ty = (140 - cy) * e
        grabRef.current?.setAttribute(
          'transform',
          `translate(${VIEW.width} ${(cy + ty).toFixed(2)}) scale(${sx.toFixed(3)} ${sy.toFixed(3)}) translate(${-(PIX_ANCHOR.x + 30 * scale)} ${-cy})`
        )
        if (k < 1) {
          g.raf = requestAnimationFrame(step)
          return
        }
      } else {
        grabRef.current?.setAttribute(
          'transform',
          `translate(${g.x.toFixed(2)} ${lagY.toFixed(2)}) rotate(${g.swing.toFixed(2)} ${px} ${py}) translate(${px} ${py}) scale(${(1 / (1 + stretch * 0.6)).toFixed(3)} ${(1 + stretch).toFixed(3)}) translate(${-px} ${-py})`
        )
      }
      if (g.released && g.squashAt) {
        // Schiacciato contro la parete: ora è di nuovo la barra.
        g.squashAt = 0
        morph.current?.go(0, true)
        grabRef.current?.removeAttribute('transform')
        g.raf = 0
        g.last = 0
        g.released = false
        setGrabbed(false)
        setHovered(false)
        morph.current?.go(0)
        release(g.token)
        g.token = null
        return
      }
      g.raf = requestAnimationFrame(step)
    }
    g.raf = requestAnimationFrame(step)
  }

  const onBarPointerDown = (e: React.PointerEvent<SVGElement>) => {
    // Si sposta solo a pannello chiuso (barra o Pix appena formato al passaggio del mouse).
    if (e.button !== 0 || panelOpen) return
    e.currentTarget.setPointerCapture(e.pointerId)
    barDrag.current = { startY: e.screenY, startX: e.screenX, startLift: settings.barLift, lift: settings.barLift, moved: false, raf: 0, pix: false }
  }
  const onBarPointerMove = (e: React.PointerEvent<SVGElement>) => {
    const d = barDrag.current
    if (!d) return
    const dx = e.screenX - d.startX
    const dy = e.screenY - d.startY
    if (!d.moved && Math.hypot(dx, dy) < 5) return
    if (!d.moved) {
      d.moved = true
      draggingBar.current = true
      // Se è già Pix viene afferrato (e si spaventa); se è la barra, si sposta la barra.
      d.pix = Boolean(morph.current?.formed)
      if (d.pix) {
        const g = grabState.current
        g.token = claim('grab', 10 * 60_000)
        g.released = false
        g.t0 = performance.now()
        g.releaseAt = 0
        g.lift = d.startLift
        g.ly = d.startLift
        // Tenuto per la cima: si allunga in una punta morbida e pende sotto; si allenta quando lo lasci.
        morph.current?.perform((b, t) => {
          const now = performance.now()
          let env = Math.min(1, (now - g.t0) / 260)
          if (g.releaseAt) env *= Math.max(0, 1 - (now - g.releaseAt) / 420)
          return grabShape(b, t, env)
        }, 600)
        setGrabbed(true)
      } else {
        setHovered(false)
        morph.current?.go(0)
      }
    }
    d.lift = Math.max(0, d.startLift - dy)
    if (d.pix) {
      // Orizzontale: Pix insegue il cursore dentro la sua finestra.
      const r = svgRef.current?.getBoundingClientRect()
      const g = grabState.current
      const minX = r ? -(r.left + PIX_ANCHOR.x - 30) : -400
      g.tx = Math.max(minX, Math.min(10, dx))
      g.lift = d.lift
      runGrab()
    } else {
      // Velocità della barra: il liquido resta indietro rispetto al movimento.
      const sp = barSpring.current
      const now = performance.now()
      if (sp.lastAt && now > sp.lastAt) {
        const v = ((d.lift - sp.lastLift) / (now - sp.lastAt)) * 1000
        sp.target = Math.max(-28, Math.min(28, v * 0.03))
      }
      sp.lastLift = d.lift
      sp.lastAt = now
      runBarSpring()
    }
    // Verticale: la finestra (barra e Pix) segue il cursore, dal fondo fino in cima.
    if (!d.raf) {
      d.raf = requestAnimationFrame(() => {
        d.raf = 0
        void window.pix.moveBar(d.lift, false).then((applied) => {
          if (d.pix) grabState.current.lift = applied
        })
      })
    }
  }
  const onBarPointerUp = (e: React.PointerEvent<SVGElement>) => {
    const d = barDrag.current
    if (!d) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (d.moved) {
      void window.pix.moveBar(d.lift, true)
      if (d.pix) {
        // Lasciato andare: scivola di nuovo contro il bordo, dondolando, e torna barra.
        const g = grabState.current
        g.releaseAt = performance.now()
        g.squashAt = 0
        g.tx = VIEW.width - PIX_ANCHOR.x - 30 * scale + 4
        g.released = true
        runGrab()
      } else {
        // Rilasciata: l'allungamento rientra piano, senza rimbalzi.
        const sp = barSpring.current
        sp.target = 0
        sp.lastAt = 0
        runBarSpring()
      }
    }
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
      data-yawn={yawning && formed && !reducedMotion && (act === 'yawn' || act === 'preview') ? '' : undefined}
      data-hungry={hungry && formed ? '' : undefined}
      data-swallow={formed && swallowPhase ? swallowPhase : undefined}
      data-weather={ep ?? undefined}
      data-shiver={shivering && ep === 'cold' ? '' : undefined}
      data-melt={melting && ep === 'hot' ? '' : undefined}
      data-trash={trash && formed ? '' : undefined}
      data-hourglass={hourglassOn ? '' : undefined}
      data-wince={wince && ep === 'rain' ? '' : undefined}
      data-grabbed={grabbed ? '' : undefined}

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
        {/* Caldo: ondine di calore che salgono da dietro a Pix */}
        {ep === 'hot' && (
          <g className="heat" stroke={color} strokeOpacity="0.55" strokeWidth="1.8" fill="none" strokeLinecap="round" pointerEvents="none">
            {[-16, 0, 16].map((dx, i) => (
              <path
                key={dx}
                style={{ ['--heat-delay' as string]: `${i * 0.5}s` }}
                d={`M${PIX_ANCHOR.x + dx * scale} ${PIX_ANCHOR.y - 72 * scale} q3 -4 0 -8 q-3 -4 0 -8`}
              />
            ))}
          </g>
        )}
        <g className="grab" ref={grabRef}>
        {/* Clessidra: si capovolge attorno al collo */}
        <g ref={flipRef}>
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
              {ep === 'sun' && <SunDefs id={fillId} scale={scale} />}
              {/* Caldo: vapore che sale da dietro la testa */}
              {ep === 'hot' && melting && (
                <g transform={face} pointerEvents="none">
                  <g className="steam" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" opacity=".8">
                    <path className="steam-1" d="M38 36q-4 -5 0 -10q4 -5 0 -10" />
                    <path className="steam-2" d="M52 34q-4 -5 0 -10q4 -5 0 -10" />
                    <path className="steam-3" d="M65 37q-4 -5 0 -10q4 -5 0 -10" />
                  </g>
                </g>
              )}
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
              {/* Sole: il lato verso la luce si accende di un bordo dorato */}
              {ep === 'sun' && <BodyTint source={bodyRef} className="sun-tint" fill={`url(#${fillId}-rim)`} />}
              {/* Si scioglie: palline che si gonfiano in punta alle colate, si staccano e cadono */}
              {meltDrops > 0 && formed && (act === 'section' || act === 'spontaneous' || act === 'preview') && (
                <MeltDrops key={meltDrops} start={meltDrops} scale={scale} shape={shape} color={color} />
              )}
              <g ref={faceRef} transform={face} opacity="0" pointerEvents="none">
                <g className="face-fx">
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
                      <g ref={eyesRef} className={`eyes ${blink && !hourglassOn ? 'blink' : ''}`}>
                        {grabbed ? (
                          <ScaredFace />
                        ) : ep === 'sun' ? (
                          <SunFace />
                        ) : (
                          <Eyes mood={formed ? (swallowPhase === 'chew' ? 'happy' : mood) : 'normal'} style={settings.pixEyes} />
                        )}
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
                {ep === 'sun' && settings.pixShine && <path className="sparkle" d="M27 20l1.4 3.6 3.6 1.4-3.6 1.4L27 30l-1.4-3.6-3.6-1.4 3.6-1.4z" fill="#fff" />}
                {/* Caldo: gocce di sudore che scivolano */}
                {ep === 'hot' && melting && (
                  <g className="hot-face">
                    <path className="sweat sweat-1" d="M24 40 C21.5 44.5 21 47 24 48.5 C27 47 26.5 44.5 24 40 Z" fill="#8fd3ff" stroke="#fff" strokeWidth="1" />
                    <path className="sweat sweat-2" d="M77 46 C74.5 50.5 74 53 77 54.5 C80 53 79.5 50.5 77 46 Z" fill="#8fd3ff" stroke="#fff" strokeWidth="1" />
                  </g>
                )}
                {/* Pioggia: broncio */}
                {ep === 'rain' && <path className="frown" d="M44 71.5q6-4.5 12 0" stroke="currentColor" strokeWidth="2.6" fill="none" strokeLinecap="round" />}
                {/* Freddo: denti che battono */}
                {ep === 'cold' && (
                  <path className="chatter" d="M41 70l3-2.5 3 2.5 3-2.5 3 2.5 3-2.5 3 2.5" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                )}
                </g>
              </g>
            </g>
          </g>
        </g>
        </g>
        </g>
        {/* Sole C: luce morbida da destra */}
        {ep === 'sun' && <SoftLight id={fillId} scale={scale} />}
        {/* Freddo: fiocchi di neve che scendono */}
        {ep === 'cold' && shivering && (
          <g className="snow" fill="#fff" stroke="#b9dcff" strokeWidth="0.6" pointerEvents="none">
            {[
              [-30, 0, 1],
              [-12, 0.5, 0.8],
              [6, 0.2, 1.1],
              [22, 0.75, 0.9],
              [-22, 0.95, 0.75],
              [14, 0.35, 0.85]
            ].map(([dx, delay, size]) => (
              <g key={dx} transform={`translate(${PIX_ANCHOR.x + dx! * scale} ${PIX_ANCHOR.y - 110 * scale})`}>
                <path
                  className="flake"
                  style={{ ['--flake-delay' as string]: `${delay}s`, ['--flake-size' as string]: String(size) }}
                  d="M0 -4v8M-3.5 -2l7 4M-3.5 2l7 -4"
                  stroke="#fff"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </g>
            ))}
          </g>
        )}
        {/* Pioggia: gocce che cadono sulla testa e schizzano, ognuna col suo ritmo */}
        {ep === 'rain' && rainKey > 0 && (
          <g key={rainKey} pointerEvents="none">
            {RAIN_DROPS.map(([dx, delay, size], i) => (
              <g
                key={i}
                className="rain"
                style={{ ['--rain-delay' as string]: `${delay}s` }}
                transform={`translate(${PIX_ANCHOR.x + dx * scale} ${PIX_ANCHOR.y - (64 - Math.abs(dx) * 0.12) * scale}) scale(${size})`}
              >
                <path className="rain-drop" d="M0 -9 C2.4 -5 3.4 -3 3.4 -1.4 A3.4 3.4 0 0 1 -3.4 -1.4 C-3.4 -3 -2.4 -5 0 -9 Z" fill="#8fd3ff" stroke="#fff" strokeWidth="0.8" />
                <g className="rain-splash" fill="#8fd3ff">
                  <circle cx="-5" cy="-2" r="1.3" />
                  <circle cx="5" cy="-2.5" r="1.1" />
                  <circle cx="0" cy="-4" r="0.9" />
                </g>
              </g>
            ))}
          </g>
        )}
        {/* Eliminazione: il coperchio del cestino e la cosa eliminata che ci cade dentro */}
        {trash && formed && (
          <>
            <g transform={`translate(${PIX_ANCHOR.x} ${PIX_ANCHOR.y}) scale(${scale}) translate(${-PIX_ANCHOR.x} ${-PIX_ANCHOR.y})`} pointerEvents="none">
              <g className="trash-lid">
                <rect x="19" y="163" width="64" height="7.5" rx="3.75" fill={`url(#${fillId})`} />
                <rect x="43" y="158.5" width="16" height="6" rx="3" fill={`url(#${fillId})`} />
              </g>
            </g>
            <SwallowItem key={trash.id} look={trash.look} from={trash.from} to={{ x: PIX_ANCHOR.x + 4 * scale, y: PIX_ANCHOR.y - 58 * scale }} delay={0.38} duration={0.55} />
          </>
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

/** Afferrato: occhioni tondi con un riflesso, bocca tremolante e una goccia di sudore. */
function ScaredFace() {
  return (
    <g className="scared">
      <circle cx="41" cy="51" r="6.2" fill="currentColor" />
      <circle cx="59" cy="51" r="6.2" fill="currentColor" />
      <circle cx="39.2" cy="48.8" r="1.9" fill="#fff" opacity=".55" />
      <circle cx="57.2" cy="48.8" r="1.9" fill="#fff" opacity=".55" />
      <path className="scared-mouth" d="M42 68 q2 -2.2 4 0 q2 2.2 4 0 q2 -2.2 4 0 q2 2.2 4 0" stroke="currentColor" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M78 30 C75.5 34.5 75 37 78 38.5 C81 37 80.5 34.5 78 30 Z" fill="#8fd3ff" stroke="#fff" strokeWidth="1" />
    </g>
  )
}
