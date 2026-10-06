import { useState } from 'react'
import { Disc3 } from 'lucide-react'

interface TrackArtProps {
  trackId: number
  color: string
  iconSize: number
  className?: string
}

// Shows the cover embedded in the song's file, falling back to a coloured disc icon when there isn't one.
// The image stays hidden until it loads, so songs without artwork never flash a broken image.
export function TrackArt({ trackId, color, iconSize, className = '' }: TrackArtProps) {
  const [status, setStatus] = useState<{ trackId: number; state: 'loading' | 'loaded' | 'missing' }>({
    trackId,
    state: 'loading',
  })
  const state = status.trackId === trackId ? status.state : 'loading'

  return (
    <span className={`album-thumb ${state === 'loaded' ? 'has-artwork' : color} ${className}`}>
      {state !== 'loaded' && <Disc3 size={iconSize} />}
      {state !== 'missing' && (
        <img
          key={trackId}
          src={`playlist-audio://artwork/${trackId}`}
          alt=""
          draggable={false}
          onLoad={() => setStatus({ trackId, state: 'loaded' })}
          onError={() => setStatus({ trackId, state: 'missing' })}
        />
      )}
    </span>
  )
}
