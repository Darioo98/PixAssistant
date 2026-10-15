import { useId } from 'react'
import { eyeColorFor, moodColor, type Mood, type PixEyes, type PixFinish, type PixShape } from '@shared/mascot'
import { PIX_ANCHOR, faceTransform, pixPath } from './geometry'
import { Badge, Eyes, PixFill, Shine } from './Faces'

interface Props {
  shape: PixShape
  color: string
  eyes: PixEyes
  finish: PixFinish
  shine: boolean
  mood?: Mood
  size?: number
  badge?: boolean
}

/** Pix statico, per l'anteprima e per i selettori nelle impostazioni. */
export function PixFigure({ shape, color, eyes, finish, shine, mood = 'normal', size = 48, badge = false }: Props) {
  const id = `pix-prev-${useId().replace(/:/g, '')}`
  const body = moodColor(mood, color)
  const face = faceTransform(1, shape)
  return (
    <svg
      viewBox="12 140 80 96"
      width={size * (80 / 96)}
      height={size}
      aria-hidden="true"
      style={{ color: eyeColorFor(body), overflow: 'visible' }}
    >
      <PixFill id={id} color={body} finish={finish} />
      <ellipse cx={PIX_ANCHOR.x} cy={PIX_ANCHOR.y + 6} rx="24" ry="3" fill="#000" opacity=".12" />
      <path d={pixPath(1, shape)} fill={`url(#${id})`} />
      <g transform={face}>
        {shine && <Shine />}
        <Eyes mood={mood} style={eyes} />
        {badge && <Badge mood={mood} />}
      </g>
    </svg>
  )
}
