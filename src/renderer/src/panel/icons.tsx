import type { TabId } from '@shared/ipc'
import { Glyph, type GlyphName } from './Glyph'

/** Icone di sistema di Windows per le sezioni del pannello. */
const TAB_GLYPHS: Record<TabId, GlyphName> = {
  home: 'home',
  deadlines: 'calendar',
  vault: 'lock',
  chat: 'chat',
  notes: 'note',
  timers: 'stopwatch',
  clipboard: 'clipboard',
  links: 'link',
  settings: 'settings'
}

export function TabIcon({ tab }: { tab: TabId }) {
  return <Glyph name={TAB_GLYPHS[tab]} size={18} />
}

export function CloseIcon() {
  return <Glyph name="close" size={12} />
}
