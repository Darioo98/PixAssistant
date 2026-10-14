import type { TabId } from '@shared/ipc'

/** Icone originali, tratto 1.6 px su griglia 20×20, in stile Fluent. */
const paths: Record<TabId, string> = {
  home: 'M3.5 9 10 3.5 16.5 9v7a1 1 0 0 1-1 1h-3.5v-5h-4v5H4.5a1 1 0 0 1-1-1z',
  deadlines: 'M4 5.5h12v10.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 8.5h12M7 3.5v3M13 3.5v3M7.5 12h2v2h-2z',
  vault: 'M5 9h10v7.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5zM7 9V6.5a3 3 0 0 1 6 0V9M10 12.5v2',
  chat: 'M4 5h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H9l-3.5 3v-3H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM7 9.5h6',
  notes: 'M5 3.5h7l3 3V16a.5.5 0 0 1-.5.5h-9.5A.5.5 0 0 1 4.5 16V4a.5.5 0 0 1 .5-.5zM7.5 9.5l1.5 1.5 3-3M7.5 13.5h5',
  timers: 'M10 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM10 8v3l2 1.5M8 2.5h4',
  clipboard: 'M7 4.5H5.5a1 1 0 0 0-1 1V16a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V5.5a1 1 0 0 0-1-1H13M7.5 3h5v3h-5zM7.5 10h5M7.5 13h3.5',
  links: 'M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-1 1M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l1-1',
  settings:
    'M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM10 2.8l1.4 1.9 2.3-.5.5 2.3 1.9 1.4-1 2.1 1 2.1-1.9 1.4-.5 2.3-2.3-.5L10 17.2l-1.4-1.9-2.3.5-.5-2.3-1.9-1.4 1-2.1-1-2.1 1.9-1.4.5-2.3 2.3.5z'
}

export function TabIcon({ tab }: { tab: TabId }) {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d={paths[tab]} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
