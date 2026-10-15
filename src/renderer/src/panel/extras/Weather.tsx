import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { weatherKind, type WeatherState } from '@shared/extras'
import { formatDate } from '../../format'
import './extras.css'
import { Glyph } from '../Glyph'

/** Meteo compatto per la Home (Open-Meteo, solo la città). */
export function WeatherWidget({ city }: { city: string }) {
  const { t, i18n } = useTranslation()
  const [state, setState] = useState<WeatherState>({ status: 'loading' })

  useEffect(() => {
    let alive = true
    setState({ status: 'loading' })
    void window.pix.weather().then((s) => alive && setState(s))
    return () => {
      alive = false
    }
  }, [city])

  if (state.status === 'off') {
    return (
      <button className="weather weather-empty" onClick={() => window.pix.openPanel('settings')}>
        <Glyph name="mapPin" /> {t('weather.setCity')}
      </button>
    )
  }
  if (state.status === 'loading') return <div className="weather hint">{t('weather.loading')}</div>
  if (state.status === 'error') {
    return <div className="weather hint">{state.error === 'city-not-found' ? t('weather.cityNotFound') : t('weather.error')}</div>
  }

  const w = state.weather
  const kind = weatherKind(w.code)
  return (
    <div className="weather" title={`${w.city}${w.country ? `, ${w.country}` : ''}`}>
      <span className="weather-now">
        <strong>{Math.round(w.temperature)}°</strong>
        <span className="dl-meta">
          {w.city} · {t(`weather.kinds.${kind}`)}
        </span>
      </span>
      <span className="weather-days">
        {w.days.map((d) => (
          <span key={d.date} className="weather-day" title={t(`weather.kinds.${weatherKind(d.code)}`)}>
            <span className="dl-meta">{formatDate(d.date, i18n.language, { weekday: 'short' })}</span>
            <span className="dl-meta">
              {Math.round(d.min)}°/{Math.round(d.max)}°
            </span>
          </span>
        ))}
      </span>
    </div>
  )
}
