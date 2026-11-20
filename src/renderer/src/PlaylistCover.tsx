import { useState, type ReactNode } from 'react'
import type { Playlist } from '../../shared/playlist'

interface PlaylistCoverProps {
  playlist: Pick<Playlist, 'id' | 'gradient' | 'icon' | 'imageVersion'>
  /** `mini-cover` (sidebar, menus), `playlist-art` (Home grid) or `playlist-heading-cover`. */
  className: string
  /** The class for the symbol, when the cover styles it separately (the Home grid's `art-symbol`). */
  symbolClassName?: string
  children?: ReactNode
}

// A playlist's cover: the image the user chose for it, or its gradient and symbol. The image stays hidden until it
// loads, so a cover never flashes a broken image, and falls back to the gradient if it can't be loaded.
export function PlaylistCover({ playlist, className, symbolClassName, children }: PlaylistCoverProps) {
  const source = playlist.imageVersion
    ? `playlist-audio://playlist-image/${playlist.id}?v=${playlist.imageVersion}`
    : undefined
  const [loaded, setLoaded] = useState<{ source: string; ok: boolean } | null>(null)
  const state = source && loaded?.source === source ? (loaded.ok ? 'loaded' : 'missing') : 'loading'
  const showImage = source !== undefined && state === 'loaded'

  return (
    <span className={`${className} ${playlist.gradient} ${showImage ? 'has-playlist-image' : ''}`} aria-hidden="true">
      {!showImage && (symbolClassName ? <span className={symbolClassName}>{playlist.icon}</span> : playlist.icon)}
      {source && state !== 'missing' && (
        <img
          key={source}
          className="playlist-image"
          src={source}
          alt=""
          draggable={false}
          onLoad={() => setLoaded({ source, ok: true })}
          onError={() => setLoaded({ source, ok: false })}
        />
      )}
      {children}
    </span>
  )
}
