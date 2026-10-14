/** Conversione di una combinazione di tasti in un "accelerator" di Electron. */

export interface KeyCombo {
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

const NAMED: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'"
}

function keyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  return NAMED[code] ?? null
}

/**
 * Restituisce l'accelerator (es. "Control+Alt+Space") oppure null se la
 * combinazione non è valida: serve almeno un modificatore e un tasto normale.
 */
export function comboToAccelerator(e: KeyCombo): string | null {
  const key = keyName(e.code)
  if (!key) return null
  const mods: string[] = []
  if (e.ctrlKey) mods.push('Control')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (e.metaKey) mods.push('Super')
  // Solo Maiusc + tasto romperebbe la digitazione normale.
  if (mods.length === 0 || (mods.length === 1 && mods[0] === 'Shift')) return null
  return [...mods, key].join('+')
}

/** Testo leggibile per l'interfaccia; `names` traduce i modificatori (Ctrl, Win, Maiusc…). */
export function formatAccelerator(acc: string, names: Record<string, string> = {}): string {
  return acc
    .split('+')
    .map((p) => names[p] ?? p)
    .join(' + ')
}
