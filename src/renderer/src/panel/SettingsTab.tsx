import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { UiState } from '@shared/ipc'
import { DEFAULT_SETTINGS, type SettingsPatch } from '@shared/settings'
import { comboToAccelerator, formatAccelerator } from '@shared/accelerator'

export function SettingsTab({ state }: { state: UiState }) {
  const { t } = useTranslation()
  const s = state.settings
  const [error, setError] = useState<string | null>(null)

  const save = async (patch: SettingsPatch) => {
    const res = await window.dock.setSettings(patch)
    setError(res.ok ? null : res.error === 'shortcutTaken' ? t('settings.shortcutTaken') : t('settings.saveError'))
    return res.ok
  }

  return (
    <div className="settings">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <Section title={t('settings.general')}>
        <Row label={t('settings.language')}>
          <select value={s.language} onChange={(e) => void save({ language: e.target.value as typeof s.language })}>
            {(['system', 'it', 'en'] as const).map((v) => (
              <option key={v} value={v}>
                {t(`settings.languageOptions.${v}`)}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t('settings.theme')}>
          <select value={s.theme} onChange={(e) => void save({ theme: e.target.value as typeof s.theme })}>
            {(['system', 'light', 'dark'] as const).map((v) => (
              <option key={v} value={v}>
                {t(`settings.themeOptions.${v}`)}
              </option>
            ))}
          </select>
        </Row>
      </Section>

      <Section title={t('settings.behavior')}>
        <Toggle label={t('settings.closeOnBlur')} checked={s.closeOnBlur} onChange={(v) => void save({ closeOnBlur: v })} />
        <Toggle
          label={t('settings.closeOnMouseLeave')}
          checked={s.closeOnMouseLeave}
          onChange={(v) => void save({ closeOnMouseLeave: v })}
        />
        <p className="hint">{t('settings.closeHint')}</p>
        <Toggle
          label={t('settings.hideInFullscreen')}
          checked={s.hideInFullscreen}
          onChange={(v) => void save({ hideInFullscreen: v })}
        />
      </Section>

      <Section title={t('settings.startup')}>
        <Toggle
          label={t('settings.autostart')}
          checked={s.autostart}
          onChange={(v) => void save({ autostart: v })}
        />
        {!state.autostartAvailable && <p className="hint">{t('settings.autostartDev')}</p>}
        <Row label={t('settings.shortcut')}>
          <ShortcutRecorder value={s.shortcut} onChange={save} />
        </Row>
      </Section>

      <Section title={t('settings.mascot')}>
        <Row label={t('settings.animations')}>
          <select value={s.animations} onChange={(e) => void save({ animations: e.target.value as typeof s.animations })}>
            {(['off', 'low', 'normal'] as const).map((v) => (
              <option key={v} value={v}>
                {t(`settings.animationsOptions.${v}`)}
              </option>
            ))}
          </select>
        </Row>
      </Section>

      <Section title={t('settings.data')}>
        <div className="data-dir">
          <span className="label">{t('settings.dataDir')}</span>
          <code title={state.dataDir.path}>{state.dataDir.path}</code>
          <span className="hint">{t(`settings.dataKind.${state.dataDir.kind}`)}</span>
          {state.dataDir.kind === 'business' && <p className="warning">{t('settings.businessWarning')}</p>}
          <button className="btn" onClick={() => window.dock.openDataDir()}>
            {t('settings.openDataDir')}
          </button>
        </div>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="row">
      <span>{label}</span>
      {children}
    </label>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="row toggle">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

function ShortcutRecorder({ value, onChange }: { value: string; onChange: (p: SettingsPatch) => Promise<boolean> }) {
  const { t } = useTranslation()
  const [recording, setRecording] = useState(false)
  const [invalid, setInvalid] = useState(false)

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!recording) return
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') {
      setRecording(false)
      return
    }
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return
    const acc = comboToAccelerator(e)
    setInvalid(!acc)
    if (acc) {
      setRecording(false)
      void onChange({ shortcut: acc })
    }
  }

  return (
    <span className="shortcut">
      <button
        className={`btn kbd ${recording ? 'recording' : ''}`}
        onClick={() => setRecording(true)}
        onKeyDown={onKeyDown}
        onBlur={() => setRecording(false)}
      >
        {recording ? t('settings.shortcutRecording') : formatAccelerator(value, t('settings.keys', { returnObjects: true }) as Record<string, string>)}
      </button>
      {value !== DEFAULT_SETTINGS.shortcut && (
        <button className="btn subtle" onClick={() => void onChange({ shortcut: DEFAULT_SETTINGS.shortcut })}>
          {t('settings.shortcutReset')}
        </button>
      )}
      {invalid && recording && <span className="hint">{t('settings.shortcutInvalid')}</span>}
    </span>
  )
}
