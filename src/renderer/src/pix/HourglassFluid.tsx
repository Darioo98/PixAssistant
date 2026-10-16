import { useEffect, useRef } from 'react'
import type { PixShape } from '@shared/mascot'
import { hourglassFlow, hourglassPath, restBody } from './shapes'

interface Props {
  start: number
  scale: number
  shape: PixShape
  color: string
}

/**
 * Clessidra trasparente: il corpo di Pix è il "vetro" e qui si disegna il suo
 * fluido, che scende dall'ampolla di sopra a quella di sotto con un filo sottile.
 */
export function HourglassFluid({ start, scale, shape, color }: Props) {
  const ref = useRef<SVGPathElement>(null)
  useEffect(() => {
    let raf = 0
    const b = restBody(scale, shape)
    const step = (now: number) => {
      const t = (now - start) / 1000
      ref.current?.setAttribute('d', hourglassPath(b, hourglassFlow(t)))
      if (t < 4.3) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [start, scale, shape])
  return <path ref={ref} className="hourglass-fluid" fill={color} pointerEvents="none" />
}
