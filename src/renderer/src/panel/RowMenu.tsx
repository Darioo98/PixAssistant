import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/** Menu "…" con le azioni secondarie di una riga. */
export function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Se sotto non c'è spazio (fondo del pannello o della lista che scorre), si apre verso l'alto.
  useLayoutEffect(() => {
    if (!open) {
      setUp(false)
      return
    }
    const menu = menuRef.current
    const btn = ref.current
    if (!menu || !btn) return
    let limit = window.innerHeight
    for (let el = btn.parentElement; el; el = el.parentElement) {
      const o = getComputedStyle(el).overflowY
      if (o === 'auto' || o === 'scroll' || o === 'hidden') {
        limit = Math.min(limit, el.getBoundingClientRect().bottom)
        break
      }
    }
    const b = btn.getBoundingClientRect()
    const h = menu.offsetHeight
    setUp(b.bottom + h > limit && b.top - h > 0)
  }, [open])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div className="row-menu" ref={ref}>
      <button className="icon-btn" aria-label={label} title={label} aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
          <circle cx="5" cy="10" r="1.5" fill="currentColor" />
          <circle cx="10" cy="10" r="1.5" fill="currentColor" />
          <circle cx="15" cy="10" r="1.5" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div ref={menuRef} className={`menu ${up ? 'up' : ''}`} role="menu" onClick={(e) => (e.target as HTMLElement).dataset.keep === undefined && setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  )
}

/** Eliminazione in due passi: niente si perde con un clic sbagliato. */
export function DeleteButton({ onConfirm, className = 'danger' }: { onConfirm: () => void; className?: string }) {
  const { t } = useTranslation()
  const [armed, setArmed] = useState(false)
  return armed ? (
    <button type="button" className={className} onClick={onConfirm}>
      {t('common.confirmDelete')}
    </button>
  ) : (
    <button type="button" className={className} data-keep onClick={() => setArmed(true)}>
      {t('common.delete')}
    </button>
  )
}
