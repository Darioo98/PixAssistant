import { net } from 'electron'
import { log } from './log'
import type { WeatherState, WeatherView } from '@shared/extras'

const CACHE_MS = 30 * 60_000
const TIMEOUT_MS = 10_000

/**
 * Meteo da Open-Meteo (gratuito, senza key). L'unico dato inviato è il nome
 * della città scelta nelle impostazioni (per trovarne le coordinate).
 */
export class WeatherService {
  private cache: { city: string; at: number; weather: WeatherView } | null = null
  private inflight: Promise<WeatherState> | null = null

  constructor(private readonly opts: { city: () => string; lang: () => string }) {}

  async get(force = false): Promise<WeatherState> {
    const city = this.opts.city().trim()
    if (!city) return { status: 'off' }
    if (!force && this.cache && this.cache.city === city && Date.now() - this.cache.at < CACHE_MS) {
      return { status: 'ok', weather: this.cache.weather }
    }
    this.inflight ??= this.load(city).finally(() => (this.inflight = null))
    return this.inflight
  }

  private async load(city: string): Promise<WeatherState> {
    try {
      const geo = await getJson<{ results?: Array<{ name: string; country?: string; latitude: number; longitude: number }> }>(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=${this.opts.lang()}&format=json`
      )
      const place = geo.results?.[0]
      if (!place) return { status: 'error', error: 'city-not-found' }
      const f = await getJson<{
        current: { temperature_2m: number; weather_code: number; is_day: number }
        daily: { time: string[]; temperature_2m_min: number[]; temperature_2m_max: number[]; weather_code: number[] }
      }>(
        `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
          '&current=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=3'
      )
      const weather: WeatherView = {
        city: place.name,
        country: place.country,
        temperature: f.current.temperature_2m,
        code: f.current.weather_code,
        isDay: f.current.is_day === 1,
        days: f.daily.time.map((date, i) => ({
          date,
          min: f.daily.temperature_2m_min[i] ?? 0,
          max: f.daily.temperature_2m_max[i] ?? 0,
          code: f.daily.weather_code[i] ?? 0
        })),
        updatedAt: Date.now()
      }
      this.cache = { city, at: Date.now(), weather }
      return { status: 'ok', weather }
    } catch (err) {
      log.warn('Meteo non disponibile', err)
      // Meglio un dato di poco vecchio che niente.
      if (this.cache && this.cache.city === city) return { status: 'ok', weather: this.cache.weather }
      return { status: 'error', error: 'network' }
    }
  }
}

async function getJson<T>(url: string): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await net.fetch(url, { signal: ctrl.signal, credentials: 'omit' } as RequestInit)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}
