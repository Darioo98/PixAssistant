import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { VaultOp, VaultOpResult, VaultStatus } from '@shared/vault'
import { Glyph } from '../Glyph'

/** Esegue un'operazione della cassaforte e traduce l'eventuale errore. */
export function useVaultOp() {
  const { t, i18n } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (op: VaultOp): Promise<VaultOpResult> => {
    setBusy(true)
    setError(null)
    try {
      const res = await window.pix.vault.apply(op)
      if (!res.ok) {
        const key = `vault.errors.${res.error}`
        setError(i18n.exists(key) ? t(key) : t('vault.errors.generic'))
      }
      return res
    } finally {
      setBusy(false)
    }
  }
  return { run, busy, error, setError }
}

/** Primo avvio: spiega e crea le chiavi. */
export function SetupIntro() {
  const { t } = useTranslation()
  const { run, busy, error } = useVaultOp()
  return (
    <div className="vault-card">
      <LockIcon />
      <h2>{t('vault.setup.title')}</h2>
      <p>{t('vault.setup.intro')}</p>
      {error && <p className="error">{error}</p>}
      <button className="btn primary" disabled={busy} onClick={() => void run({ op: 'setup' })}>
        {busy ? t('vault.setup.creating') : t('vault.setup.start')}
      </button>
    </div>
  )
}

/** Mostra la chiave di recupero una sola volta e chiede conferma prima di proseguire. */
export function RecoveryKeyStep() {
  const { t } = useTranslation()
  const { run } = useVaultOp()
  const [key, setKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [lastGroup, setLastGroup] = useState('')
  const [stored, setStored] = useState(false)

  useEffect(() => {
    void window.pix.vault.apply({ op: 'pendingRecovery' }).then((r) => r.ok && setKey(r.value ?? null))
  }, [])

  if (!key) return null
  const expected = key.split('-').pop() ?? ''
  const confirmed = stored && lastGroup.trim().toUpperCase() === expected

  return (
    <div className="vault-card">
      <h2>{t('vault.setup.recoveryTitle')}</h2>
      <p>{t('vault.setup.recoveryText')}</p>
      <code className="recovery-key" aria-label={t('vault.unlock.recoveryLabel')}>
        {key}
      </code>
      <button
        className="btn"
        onClick={() => void run({ op: 'copyRecovery' }).then((r) => r.ok && setCopied(true))}
      >
        {t('vault.setup.copy')}
      </button>
      {copied && <p className="hint">{t('vault.setup.copied')}</p>}
      <label className="field">
        <span className="label">{t('vault.setup.confirmLabel')}</span>
        <input
          className="mono"
          value={lastGroup}
          maxLength={4}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setLastGroup(e.target.value)}
        />
      </label>
      <label className="row toggle">
        <span>{t('vault.setup.confirmCheck')}</span>
        <input type="checkbox" role="switch" checked={stored} onChange={(e) => setStored(e.target.checked)} />
      </label>
      <button className="btn primary" disabled={!confirmed} onClick={() => void run({ op: 'ackRecovery' })}>
        {t('vault.setup.continue')}
      </button>
    </div>
  )
}

/** Campo per la chiave di recupero (collegamento di un nuovo PC o sblocco di emergenza). */
export function RecoveryForm({ mode }: { mode: 'link' | 'unlock' }) {
  const { t } = useTranslation()
  const { run, busy, error } = useVaultOp()
  const [value, setValue] = useState('')
  return (
    <form
      className="recovery-form"
      onSubmit={(e) => {
        e.preventDefault()
        void run({ op: mode === 'link' ? 'link' : 'unlockRecovery', recoveryKey: value }).then((r) => r.ok && setValue(''))
      }}
    >
      <label className="field">
        <span className="label">{t('vault.unlock.recoveryLabel')}</span>
        <input
          className="mono"
          value={value}
          autoFocus={mode === 'link'}
          spellCheck={false}
          autoComplete="off"
          placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="btn primary" type="submit" disabled={busy || value.replace(/[\s-]/g, '').length < 32}>
        {mode === 'link' ? t('vault.link.submit') : t('vault.unlock.submit')}
      </button>
    </form>
  )
}

export function LinkPc() {
  const { t } = useTranslation()
  return (
    <div className="vault-card">
      <LockIcon />
      <h2>{t('vault.link.title')}</h2>
      <p>{t('vault.link.text')}</p>
      <RecoveryForm mode="link" />
    </div>
  )
}

/** Cassaforte chiusa: Windows Hello se registrato, altrimenti (o in alternativa) la chiave di recupero. */
export function UnlockPanel({ status }: { status: VaultStatus }) {
  const { t } = useTranslation()
  const { run, busy, error } = useVaultOp()
  const [useRecovery, setUseRecovery] = useState(!status.helloEnrolled)

  return (
    <div className="vault-card compact">
      <LockIcon />
      <h2>{t('vault.unlock.title')}</h2>
      {status.helloEnrolled && (
        <button className="btn primary" disabled={busy} onClick={() => void run({ op: 'unlockHello' })}>
          {busy ? t('vault.unlock.waitingHello') : t('vault.unlock.hello')}
        </button>
      )}
      {error && <p className="error">{error}</p>}
      {useRecovery ? (
        <RecoveryForm mode="unlock" />
      ) : (
        <button className="btn subtle" onClick={() => setUseRecovery(true)}>
          {t('vault.unlock.useRecovery')}
        </button>
      )}
    </div>
  )
}

/** Invito ad attivare Windows Hello quando la cassaforte è aperta ma Hello non è registrato su questo PC. */
export function HelloBanner() {
  const { t } = useTranslation()
  const { run, busy, error } = useVaultOp()
  return (
    <div className="banner">
      <span>{t('vault.helloBanner')}</span>
      <button className="btn primary" disabled={busy} onClick={() => void run({ op: 'enrollHello' })}>
        {busy ? t('vault.unlock.waitingHello') : t('vault.helloEnable')}
      </button>
      {error && <span className="error">{error}</span>}
    </div>
  )
}

export function LockIcon() {
  return <Glyph name="lock" size={40} className="vault-icon" color="var(--accent)" />
}
