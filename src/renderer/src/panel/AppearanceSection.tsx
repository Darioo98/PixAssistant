import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PIX_TRANSFORMS, PIX_EYES, PIX_FINISHES, PIX_PALETTE, PIX_SHAPES, type Mood } from '@shared/mascot'
import { DEFAULT_SETTINGS, type Settings, type SettingsPatch } from '@shared/settings'
import { PixFigure } from '../pix/PixFigure'
import { ColorPicker } from './ColorPicker'
import { TRANSFORM_EVENT } from '../pix/Mascot'

const PREVIEW_MOODS: Mood[] = ['alert', 'happy', 'sleep']

/** Personalizzazione dell'aspetto di Pix, con anteprima dal vivo. */
export function AppearanceSection({ s, save }: { s: Settings; save: (p: SettingsPatch) => Promise<boolean> }) {
  const { t } = useTranslation()
  const look = { shape: s.pixShape, color: s.pixColor, eyes: s.pixEyes, finish: s.pixFinish, shine: s.pixShine }
  const isPalette = (PIX_PALETTE as readonly string[]).includes(s.pixColor.toUpperCase())
  const [pickerOpen, setPickerOpen] = useState(false)
  const closePicker = useCallback(() => setPickerOpen(false), [])

  return (
    <div className="appearance">
      <div className="appearance-preview">
        <PixFigure {...look} size={96} />
        <div className="appearance-moods">
          {PREVIEW_MOODS.map((m) => (
            <span key={m} title={t(`settings.previewOptions.${m}`)}>
              <PixFigure {...look} mood={m} size={40} badge={m === 'alert'} />
            </span>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="label">{t('settings.shape')}</span>
        <div className="choices">
          {PIX_SHAPES.map((shape) => (
            <button
              key={shape}
              className={`choice ${s.pixShape === shape ? 'selected' : ''}`}
              aria-pressed={s.pixShape === shape}
              title={t(`settings.shapeOptions.${shape}`)}
              onClick={() => void save({ pixShape: shape })}
            >
              <PixFigure {...look} shape={shape} size={34} />
              <span>{t(`settings.shapeOptions.${shape}`)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="label">{t('settings.color')}</span>
        <div className="swatches">
          {PIX_PALETTE.map((c) => (
            <button
              key={c}
              className={`swatch ${s.pixColor.toUpperCase() === c ? 'selected' : ''}`}
              style={{ background: c }}
              aria-label={c}
              aria-pressed={s.pixColor.toUpperCase() === c}
              onClick={() => void save({ pixColor: c })}
            />
          ))}
          <button
            className={`swatch custom ${!isPalette ? 'selected' : ''}`}
            title={t('settings.customColor')}
            aria-label={t('settings.customColor')}
            aria-expanded={pickerOpen}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setPickerOpen((o) => !o)}
          />
        </div>
        {pickerOpen && (
          <ColorPicker value={s.pixColor} onChange={(hex) => void save({ pixColor: hex })} onClose={closePicker} />
        )}
      </div>

      <div className="field">
        <span className="label">{t('settings.eyes')}</span>
        <div className="choices">
          {PIX_EYES.map((eyes) => (
            <button
              key={eyes}
              className={`choice ${s.pixEyes === eyes ? 'selected' : ''}`}
              aria-pressed={s.pixEyes === eyes}
              onClick={() => void save({ pixEyes: eyes })}
            >
              <PixFigure {...look} eyes={eyes} size={34} />
              <span>{t(`settings.eyesOptions.${eyes}`)}</span>
            </button>
          ))}
        </div>
      </div>

      <label className="row toggle">
        <span>{t('settings.transforms')}</span>
        <input type="checkbox" role="switch" checked={s.pixTransforms} onChange={(e) => void save({ pixTransforms: e.target.checked })} />
      </label>
      <p className="hint">{t('settings.transformsHint')}</p>
      <div className="field">
        <span className="label">{t('settings.tryTransforms')}</span>
        <div className="preview-buttons">
          {PIX_TRANSFORMS.map((x) => (
            <button key={x} className="pill" onClick={() => window.dispatchEvent(new CustomEvent(TRANSFORM_EVENT, { detail: x }))}>
              {t(`settings.transformOptions.${x}`)}
            </button>
          ))}
        </div>
      </div>

      <label className="row">
        <span>{t('settings.finish')}</span>
        <select value={s.pixFinish} onChange={(e) => void save({ pixFinish: e.target.value as Settings['pixFinish'] })}>
          {PIX_FINISHES.map((f) => (
            <option key={f} value={f}>
              {t(`settings.finishOptions.${f}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="row toggle">
        <span>{t('settings.shine')}</span>
        <input type="checkbox" role="switch" checked={s.pixShine} onChange={(e) => void save({ pixShine: e.target.checked })} />
      </label>

      <p className="hint">{t('settings.appearanceHint')}</p>
      <button
        className="btn subtle"
        onClick={() =>
          void save({
            pixShape: DEFAULT_SETTINGS.pixShape,
            pixColor: DEFAULT_SETTINGS.pixColor,
            pixEyes: DEFAULT_SETTINGS.pixEyes,
            pixFinish: DEFAULT_SETTINGS.pixFinish,
            pixShine: DEFAULT_SETTINGS.pixShine
          })
        }
      >
        {t('settings.resetAppearance')}
      </button>
    </div>
  )
}
