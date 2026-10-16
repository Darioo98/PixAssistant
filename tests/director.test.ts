import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Director, type Act } from '../src/renderer/src/pix/director'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('regista delle animazioni', () => {
  it('una alla volta: la più importante interrompe, le altre aspettano', () => {
    const changes: Array<Act | null> = []
    const interrupted: Act[] = []
    const d = new Director((a) => changes.push(a), (a) => interrupted.push(a))

    const weather = d.claim('weather', 3000)
    expect(weather).not.toBeNull()
    expect(d.claim('yawn', 2000)).toBeNull() // pari importanza ma diversa: aspetta
    expect(d.claim('section', 4000)).not.toBeNull() // più importante: interrompe il meteo
    expect(interrupted).toEqual(['weather'])
    expect(d.claim('weather', 3000)).toBeNull()
    expect(d.claim('section', 4000)).not.toBeNull() // la stessa può ripartire (altra sezione)

    vi.advanceTimersByTime(4100)
    expect(d.active).toBeNull()
    expect(changes.at(-1)).toBeNull()
    const t = d.claim('trash', 2000)
    d.release(weather) // un gettone vecchio non libera il palco altrui
    expect(d.active).toBe('trash')
    d.release(t)
    expect(d.active).toBeNull()
  })

  it('il meteo provato dalle impostazioni parte subito e si può rilanciare', () => {
    const interrupted: Act[] = []
    const d = new Director(() => {}, (a) => interrupted.push(a))
    d.claim('section', 4000)
    expect(d.claim('weather', 4200)).toBeNull() // il meteo spontaneo aspetta
    expect(d.claim('weatherTry', 4200)).not.toBeNull() // la prova no
    expect(interrupted).toEqual(['section'])
    expect(d.claim('weatherTry', 4200)).not.toBeNull() // un altro clic la fa ripartire
    expect(d.claim('spontaneous', 4200)).toBeNull()
  })
})
