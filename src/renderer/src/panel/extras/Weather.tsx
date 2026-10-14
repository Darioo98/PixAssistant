import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { WEATHER_ICONS, weatherKind, type WeatherState } from '@shared/extras'
import { formatDate } from '../../format'
import './extras.css'

/** Meteo compatto per la Home (Open-Meteo, solo la città). */
export function WeatherWidget({ city }: { city: string }) {
  const { t, i18n } = useTranslation()
  const [state, setState] = useState<WeatherState>({ status: 'loading' })

  useEffect(() => {
    let alive = true
    setState({ status: 'loading' })
    void window.dock.weather().then((s) => alive && setState(s))
    return () => {
      alive = false
    }
  }, [city])

  if (state.status === 'off') {
    return (
      <button className="weather weather-empty" onClick={() => window.dock.openPanel('settings')}>
        ⛅ {t('weather.setCity')}
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
      <span className="weather-icon" aria-hidden="true">
        {WEATHER_ICONS[kind][w.isDay ? 'day' : 'night']}
      </span>
      <span className="weather-now">
        <strong>{Math.round(w.temperature)}°</strong>
        <span className="dl-meta">
          {w.city} · {t(`weather.kinds.${kind}`)}
        </span>
      </span>
      <span className="weather-days">
        {w.days.map((d) => (
          <span key={d.date} className="weather-day">
            <span className="dl-meta">{formatDate(d.date, i18n.language, { weekday: 'short' })}</span>
            <span aria-hidden="true">{WEATHER_ICONS[weatherKind(d.code)].day}</span>
            <span className="dl-meta">
              {Math.round(d.min)}°/{Math.round(d.max)}°
            </span>
          </span>
        ))}
      </span>
    </div>
  )
}
