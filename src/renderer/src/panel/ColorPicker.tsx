import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HEX_COLOR } from '@shared/mascot'
import { hexToHsv, hsvToHex, type HSV } from '@shared/color'

/**
 * Selettore di colore interno al pannello. Il selettore nativo di Electron su
 * Windows apre una finestra di sistema: la finestra di Dock perderebbe il
 * focus e il pannello si chiuderebbe mentre scegli il colore.
 */

const SAVE_DELAY_MS = 250

export function ColorPicker({ value, onChange, onClose }: { value: string; onChange: (hex: string) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(value))
  const [hexText, setHexText] = useState(value)
  const areaRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<number | undefined>(undefined)

  const hex = hsvToHex(hsv)

  // Salvataggio con un piccolo ritardo: niente scritture a ogni movimento del mouse.
  const commit = (next: HSV) => {
    setHsv(next)
    setHexText(hsvToHex(next))
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => onChange(hsvToHex(next)), SAVE_DELAY_MS)
  }

  useEffect(() => () => window.clearTimeout(saveTimer.current), [])

  useEffect(() => {
    const close = (e: MouseEvent) => !rootRef.current?.contains(e.target as Node) && onClose()
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [onClose])

  const pickAt = (clientX: number, clientY: number) => {
    const r = areaRef.current!.getBoundingClientRect()
    const s = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    const v = 1 - Math.min(1, Math.max(0, (clientY - r.top) / r.height))
    commit({ ...hsv, s, v })
  }

  return (
    <div className="color-picker" ref={rootRef} role="dialog" aria-label={t('settings.customColor')}>
      <div
        ref={areaRef}
        className="cp-area"
        style={{ background: `hsl(${hsv.h} 100% 50%)` }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          pickAt(e.clientX, e.clientY)
        }}
        onPointerMove={(e) => e.buttons === 1 && pickAt(e.clientX, e.clientY)}
      >
        <span className="cp-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
      </div>
      <input
        className="cp-hue"
        type="range"
        min={0}
        max={359}
        value={Math.round(hsv.h)}
        aria-label={t('settings.hue')}
        onChange={(e) => commit({ ...hsv, h: Number(e.target.value) })}
      />
      <div className="cp-row">
        <span className="cp-preview" style={{ background: hex }} />
        <input
          className="cp-hex"
          value={hexText}
          maxLength={7}
          spellCheck={false}
          aria-label="HEX"
          onChange={(e) => {
            const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`
            setHexText(v)
            if (HEX_COLOR.test(v)) commit(hexToHsv(v))
          }}
        />
        <button className="btn primary" onClick={onClose}>
          {t('settings.colorDone')}
        </button>
      </div>
    </div>
  )
}
