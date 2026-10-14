import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { PREVIEWS, type UiState } from '@shared/ipc'
import { DEFAULT_SETTINGS, type SettingsPatch } from '@shared/settings'
import { comboToAccelerator, formatAccelerator } from '@shared/accelerator'
import { AppearanceSection } from './AppearanceSection'
import { DEFAULT_MODELS } from '@shared/chat'

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

      <Section title={t('settings.appearance')}>
        <AppearanceSection s={s} save={save} />
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
        <p className="hint">{t('settings.animationsHint')}</p>
        <Row label={t('settings.mascotSize')}>
          <select value={s.mascotSize} onChange={(e) => void save({ mascotSize: e.target.value as typeof s.mascotSize })}>
            {(['small', 'medium', 'large'] as const).map((v) => (
              <option key={v} value={v}>
                {t(`settings.mascotSizeOptions.${v}`)}
              </option>
            ))}
          </select>
        </Row>
        <Toggle
          label={t('settings.eyesFollowCursor')}
          checked={s.eyesFollowCursor}
          onChange={(v) => void save({ eyesFollowCursor: v })}
        />
        <Row label={t('settings.bubbleSeconds')}>
          <input
            type="number"
            className="num"
            min={3}
            max={120}
            defaultValue={s.bubbleSeconds}
            key={s.bubbleSeconds}
            onBlur={(e) => {
              const v = Math.round(Number(e.target.value))
              if (v !== s.bubbleSeconds) void save({ bubbleSeconds: Math.min(120, Math.max(3, v || 12)) })
            }}
          />
        </Row>
        <div className="row">
          <span>{t('settings.preview')}</span>
        </div>
        <div className="preview-buttons">
          {PREVIEWS.map((p) => (
            <button key={p} className="pill" onClick={() => window.dock.previewMascot(p)}>
              {t(`settings.previewOptions.${p}`)}
            </button>
          ))}
        </div>
      </Section>

      <Section title={t('settings.deadlines')}>
        <Row label={t('settings.defaultLeadDays')}>
          <input
            type="number"
            className="num"
            min={0}
            max={365}
            defaultValue={s.defaultLeadDays}
            key={s.defaultLeadDays}
            onBlur={(e) => {
              const v = Math.min(365, Math.max(0, Math.round(Number(e.target.value)) || 0))
              if (v !== s.defaultLeadDays) void save({ defaultLeadDays: v })
            }}
          />
        </Row>
      </Section>

      <Section title={t('settings.vault')}>
        <Row label={t('settings.sessionHours')}>
          <input
            type="number"
            className="num"
            min={1}
            max={72}
            defaultValue={s.vaultSessionHours}
            key={s.vaultSessionHours}
            onBlur={(e) => {
              const v = Math.min(72, Math.max(1, Math.round(Number(e.target.value)) || 8))
              if (v !== s.vaultSessionHours) void save({ vaultSessionHours: v })
            }}
          />
        </Row>
        <Row label={t('settings.generatorDefaults')}>
          <input
            type="number"
            className="num"
            min={8}
            max={128}
            defaultValue={s.genLength}
            key={s.genLength}
            onBlur={(e) => {
              const v = Math.min(128, Math.max(8, Math.round(Number(e.target.value)) || 20))
              if (v !== s.genLength) void save({ genLength: v })
            }}
          />
        </Row>
        {state.vault.helloAvailable && state.vault.setup === 'ready' && (
          <div className="row">
            <span>
              {t('settings.hello')}: {state.vault.helloEnrolled ? t('settings.helloOn') : t('settings.helloOff')}
            </span>
            {state.vault.helloEnrolled ? (
              <button className="btn subtle" onClick={() => void window.dock.vault.apply({ op: 'removeHello' })}>
                {t('settings.helloRemove')}
              </button>
            ) : (
              state.vault.unlocked && (
                <button className="btn" onClick={() => void window.dock.vault.apply({ op: 'enrollHello' })}>
                  {t('settings.helloEnable')}
                </button>
              )
            )}
          </div>
        )}
      </Section>

      <Section title={t('settings.ai')}>
        <Row label={t('settings.aiProvider')}>
          <select value={s.aiProvider} onChange={(e) => void save({ aiProvider: e.target.value as typeof s.aiProvider })}>
            <option value="claude-subscription">{t('settings.aiProviders.claude-subscription')}</option>
          </select>
        </Row>
        <Row label={t('settings.aiModel')}>
          <select value={s.aiModel} onChange={(e) => void save({ aiModel: e.target.value })}>
            {DEFAULT_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </Row>
        <p className="hint">{t('settings.aiFuture')}</p>
      </Section>

      <Section title={t('settings.dnd')}>
        <Toggle label={t('settings.dndEnabled')} checked={s.dndEnabled} onChange={(v) => void save({ dndEnabled: v })} />
        {s.dndEnabled && (
          <div className="row">
            <span>
              {t('settings.dndFrom')}{' '}
              <input type="time" value={s.dndFrom} onChange={(e) => e.target.value && void save({ dndFrom: e.target.value })} />
            </span>
            <span>
              {t('settings.dndTo')}{' '}
              <input type="time" value={s.dndTo} onChange={(e) => e.target.value && void save({ dndTo: e.target.value })} />
            </span>
          </div>
        )}
        <p className="hint">{t('settings.dndHint')}</p>
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
