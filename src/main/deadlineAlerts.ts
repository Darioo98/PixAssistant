import type { TFunction } from 'i18next'
import { addDays, diffDays } from '@shared/dates'
import { needsAlert } from '@shared/deadlines'
import type { AlertSource } from './alerts'
import type { DeadlineService } from './deadlines'

/** Avvisi delle scadenze: secondo il preavviso della singola voce, uno al giorno. */
export function deadlineAlerts(opts: {
  deadlines: DeadlineService
  defaultLead: () => number
  t: () => TFunction
  open: () => void
}): AlertSource {
  return (today) => {
    const t = opts.t()
    return opts.deadlines
      .list()
      .filter((d) => needsAlert(d, today, opts.defaultLead()))
      .map((d) => {
        const days = diffDays(today, d.date)
        const text =
          days < 0
            ? t('deadlines.alert.overdue', { title: d.title, count: -days })
            : days === 0
              ? t('deadlines.alert.today', { title: d.title })
              : t('deadlines.alert.soon', { title: d.title, count: days })
        return {
          key: `deadline:${d.id}`,
          category: t('deadlines.category'),
          title: d.title,
          text,
          actions: [
            { id: 'open', label: t('alerts.open') },
            { id: 'tomorrow', label: t('alerts.tomorrow') },
            { id: 'done', label: t('alerts.done'), primary: true }
          ],
          onOpen: opts.open,
          onAction: (id) => {
            if (id === 'open') opts.open()
            else if (id === 'tomorrow') opts.deadlines.snooze(d.id, addDays(today, 1))
            else if (id === 'done') opts.deadlines.done(d.id)
          }
        }
      })
  }
}
