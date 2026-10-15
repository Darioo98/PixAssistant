import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Settings } from '@shared/settings'
import { INTERVAL_PRESETS, passwordStrength, type GeneratorOptions, type VaultEntryView, type VaultGroupView } from '@shared/vault'
import { formatDate } from '../../format'
import { DeleteButton } from '../RowMenu'
import { useVaultOp } from './VaultAccess'
import { GroupSelect } from './VaultGroups'

export function generatorDefaults(s: Settings): GeneratorOptions {
  return { length: s.genLength, symbols: s.genSymbols, avoidAmbiguous: s.genAvoidAmbiguous }
}

/** Indicatore di robustezza a 4 tacche. */
export function StrengthMeter({ password }: { password: string }) {
  const { t } = useTranslation()
  if (!password) return null
  const score = passwordStrength(password)
  return (
    <div className={`strength s${score}`} aria-label={t(`vault.strength.${score}`)}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={i <= score ? 'on' : ''} />
      ))}
      <em>{t(`vault.strength.${score}`)}</em>
    </div>
  )
}

/** Opzioni del generatore e anteprima. Le password le genera il processo main (crypto.randomInt). */
export function Generator({
  options,
  onOptions,
  onUse,
  useLabel
}: {
  options: GeneratorOptions
  onOptions: (o: GeneratorOptions) => void
  onUse: (password: string) => void
  useLabel: string
}) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState('')
  const regenerate = async (o = options) => {
    const r = await window.pix.vault.apply({ op: 'generate', options: o })
    if (r.ok && r.value) setPreview(r.value)
  }
  useEffect(() => {
    void regenerate()
  }, [options.length, options.symbols, options.avoidAmbiguous])

  return (
    <div className="generator">
      <code className="gen-preview">{preview}</code>
      <StrengthMeter password={preview} />
      <label className="row">
        <span>
          {t('vault.generator.length')}: {options.length}
        </span>
        <input
          type="range"
          min={8}
          max={64}
          value={options.length}
          onChange={(e) => onOptions({ ...options, length: Number(e.target.value) })}
        />
      </label>
      <label className="row toggle">
        <span>{t('vault.generator.symbols')}</span>
        <input type="checkbox" role="switch" checked={options.symbols} onChange={(e) => onOptions({ ...options, symbols: e.target.checked })} />
      </label>
      <label className="row toggle">
        <span>{t('vault.generator.avoidAmbiguous')}</span>
        <input
          type="checkbox"
          role="switch"
          checked={options.avoidAmbiguous}
          onChange={(e) => onOptions({ ...options, avoidAmbiguous: e.target.checked })}
        />
      </label>
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => void regenerate()}>
          {t('vault.generator.regenerate')}
        </button>
        <span className="spacer" />
        <button type="button" className="btn primary" disabled={!preview} onClick={() => onUse(preview)}>
          {useLabel}
        </button>
      </div>
    </div>
  )
}

/** "Nuova password" su una voce esistente: genera, salva (storico + countdown azzerato) e copia. */
export function NewPasswordDialog({ entry, settings, onClose }: { entry: VaultEntryView; settings: Settings; onClose: () => void }) {
  const { t } = useTranslation()
  const { run, error } = useVaultOp()
  const [options, setOptions] = useState(generatorDefaults(settings))
  const [done, setDone] = useState(false)

  if (done) {
    return (
      <div className="vault-card">
        <h2>{t('vault.generator.newFor', { name: entry.name })}</h2>
        <p>{t('vault.newPasswordDone')}</p>
        <button className="btn primary" onClick={onClose}>
          {t('vault.setup.done')}
        </button>
      </div>
    )
  }
  return (
    <div className="dl-form">
      <h2>{t('vault.generator.newFor', { name: entry.name })}</h2>
      <p className="hint">{t('vault.generator.newHint')}</p>
      {/* L'anteprima è solo indicativa: la password definitiva la genera e la copia il processo main. */}
      <Generator
        options={options}
        onOptions={setOptions}
        useLabel={t('vault.generator.generateAndCopy')}
        onUse={() => void run({ op: 'newPassword', id: entry.id, options }).then((r) => r.ok && setDone(true))}
      />
      {error && <p className="error">{error}</p>}
      <button className="btn subtle" onClick={onClose}>
        {t('vault.form.cancel')}
      </button>
    </div>
  )
}

/** Crea o modifica una voce della cassaforte. */
export function VaultForm({
  entry,
  settings,
  groups,
  defaultGroup,
  onClose
}: {
  entry?: VaultEntryView
  settings: Settings
  groups: VaultGroupView[]
  defaultGroup: string | null
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const { run, busy, error } = useVaultOp()
  const [name, setName] = useState(entry?.name ?? '')
  const [groupId, setGroupId] = useState<string | null>(entry ? entry.groupId : defaultGroup)
  const [username, setUsername] = useState(entry?.username ?? '')
  const [password, setPassword] = useState<string | null>(entry ? null : '') // null = invariata, non ancora letta
  const [show, setShow] = useState(false)
  const [url, setUrl] = useState(entry?.url ?? '')
  const [notes, setNotes] = useState(entry?.notes ?? '')
  const preset = (INTERVAL_PRESETS as readonly number[]).includes(entry?.intervalDays ?? 90)
  const [intervalMode, setIntervalMode] = useState(preset ? String(entry?.intervalDays ?? 90) : 'custom')
  const [customDays, setCustomDays] = useState(entry?.intervalDays ?? 120)
  const [genOpen, setGenOpen] = useState(false)
  const [genOptions, setGenOptions] = useState(generatorDefaults(settings))

  const intervalDays = intervalMode === 'custom' ? customDays : Number(intervalMode)

  /** La password esistente si legge solo quando serve (mostra o modifica). */
  const loadPassword = async () => {
    if (password !== null || !entry) return
    const r = await window.pix.vault.apply({ op: 'reveal', id: entry.id })
    // Se nel frattempo l'utente ha già scritto, vince quello che ha scritto.
    setPassword((prev) => (prev === null ? (r.ok ? (r.value ?? '') : '') : prev))
  }

  const save = async () => {
    const res = await run({
      op: 'save',
      input: {
        id: entry?.id,
        name: name.trim(),
        username,
        password: password === null ? undefined : password,
        url: url.trim(),
        notes,
        intervalDays,
        groupId
      }
    })
    if (res.ok) onClose()
  }

  return (
    <form
      className="dl-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim()) void save()
      }}
    >
      <h2>{entry ? t('vault.form.editTitle') : t('vault.form.newTitle')}</h2>
      <label className="field">
        <span className="label">{t('vault.form.name')}</span>
        <input autoFocus value={name} maxLength={200} placeholder={t('vault.form.namePlaceholder')} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="field">
        <span className="label">{t('vault.groups.label')}</span>
        <GroupSelect groups={groups} value={groupId} onChange={setGroupId} />
      </div>
      <label className="field">
        <span className="label">{t('vault.form.username')}</span>
        <input value={username} maxLength={500} autoComplete="off" spellCheck={false} onChange={(e) => setUsername(e.target.value)} />
      </label>

      <div className="field">
        <span className="label">{t('vault.form.password')}</span>
        <div className="inline">
          <input
            className="grow mono"
            type={show ? 'text' : 'password'}
            value={password ?? ''}
            placeholder={entry?.hasPassword ? '••••••••••' : ''}
            maxLength={1000}
            autoComplete="new-password"
            spellCheck={false}
            onFocus={() => void loadPassword()}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            className="btn"
            onClick={() => {
              void loadPassword()
              setShow(!show)
            }}
          >
            {show ? t('vault.form.hide') : t('vault.form.show')}
          </button>
          <button type="button" className="btn" onClick={() => setGenOpen(!genOpen)}>
            {t('vault.form.generate')}
          </button>
        </div>
        {password !== null && <StrengthMeter password={password} />}
        {entry && <span className="hint">{t('vault.form.manualChangeHint')}</span>}
      </div>

      {genOpen && (
        <Generator
          options={genOptions}
          onOptions={setGenOptions}
          useLabel={t('vault.generator.use')}
          onUse={(pw) => {
            setPassword(pw)
            setShow(true)
            setGenOpen(false)
          }}
        />
      )}

      <label className="field">
        <span className="label">{t('vault.form.url')}</span>
        <input value={url} maxLength={2000} spellCheck={false} placeholder="https://" onChange={(e) => setUrl(e.target.value)} />
      </label>

      <div className="field">
        <span className="label">{t('vault.form.interval')}</span>
        <div className="inline">
          <select value={intervalMode} onChange={(e) => setIntervalMode(e.target.value)}>
            {INTERVAL_PRESETS.map((d) => (
              <option key={d} value={String(d)}>
                {t(`vault.form.intervalOptions.${d}`)}
              </option>
            ))}
            <option value="custom">{t('vault.form.custom')}</option>
          </select>
          {intervalMode === 'custom' && (
            <>
              <input
                type="number"
                className="num"
                min={1}
                max={3650}
                value={customDays}
                onChange={(e) => setCustomDays(Math.max(1, Math.min(3650, Math.round(Number(e.target.value)) || 1)))}
              />
              <span>{t('vault.form.days')}</span>
            </>
          )}
        </div>
        {entry && <span className="hint">{t('vault.form.lastChanged', { date: formatDate(entry.lastChanged, i18n.language) })}</span>}
      </div>

      <label className="field">
        <span className="label">{t('vault.form.notes')}</span>
        <textarea rows={3} value={notes} maxLength={10_000} onChange={(e) => setNotes(e.target.value)} />
      </label>

      {entry && (entry.historyCount ?? 0) > 0 && <p className="hint">{t('vault.form.history', { count: entry.historyCount })}</p>}
      {error && <p className="error">{error}</p>}

      <div className="form-actions">
        {entry && (
          <DeleteButton
            className="btn danger-text"
            onConfirm={() => void window.pix.vault.apply({ op: 'remove', id: entry.id }).then(onClose)}
          />
        )}
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>
          {t('vault.form.cancel')}
        </button>
        <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
          {t('vault.form.save')}
        </button>
      </div>
    </form>
  )
}
