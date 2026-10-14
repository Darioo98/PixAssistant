import { useTranslation } from 'react-i18next'

/** Pix nello stato normale (dalla bozza approvata). Stati e morph arrivano nella milestone 2. */
export function Pix({ onClick }: { onClick?: () => void }) {
  const { t } = useTranslation()
  return (
    <button className="pix" data-hit aria-label={t('pix.label')} onClick={onClick}>
      <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
        <ellipse cx="50" cy="94" rx="24" ry="3" fill="#000" opacity=".12" />
        <path d="M50 22c22 0 30 8 30 30v6c0 22-8 30-30 30s-30-8-30-30v-6c0-22 8-30 30-30z" fill="var(--pix-color)" />
        <path d="M30 34q4-8 14-9" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".35" fill="none" />
        <rect className="pix-eye" x="38.3" y="46" width="5.4" height="12" rx="2.7" fill="#fff" />
        <rect className="pix-eye" x="56.3" y="46" width="5.4" height="12" rx="2.7" fill="#fff" />
      </svg>
    </button>
  )
}
