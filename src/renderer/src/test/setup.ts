import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

// jsdom has no media playback, so <audio> gets a minimal stand-in: play/pause flip `paused`, and loading a
// new source rewinds to the start and goes back to the default speed like a real browser does. Tests drive time,
// duration and endings themselves.
interface MediaState {
  paused: boolean
  currentTime: number
  duration: number
  playbackRate: number
  defaultPlaybackRate: number
  preservesPitch: boolean
}
const media = new WeakMap<HTMLMediaElement, MediaState>()
function state(element: HTMLMediaElement): MediaState {
  if (!media.has(element)) {
    media.set(element, {
      paused: true,
      currentTime: 0,
      duration: Number.NaN,
      playbackRate: 1,
      defaultPlaybackRate: 1,
      preservesPitch: true,
    })
  }
  return media.get(element)!
}

Object.defineProperties(HTMLMediaElement.prototype, {
  paused: {
    configurable: true,
    get(this: HTMLMediaElement) {
      return state(this).paused
    },
  },
  duration: {
    configurable: true,
    get(this: HTMLMediaElement) {
      return state(this).duration
    },
  },
  currentTime: {
    configurable: true,
    get(this: HTMLMediaElement) {
      return state(this).currentTime
    },
    set(this: HTMLMediaElement, value: number) {
      state(this).currentTime = value
    },
  },
  playbackRate: {
    configurable: true,
    get(this: HTMLMediaElement) {
      return state(this).playbackRate
    },
    set(this: HTMLMediaElement, value: number) {
      state(this).playbackRate = value
    },
  },
  preservesPitch: {
    configurable: true,
    get(this: HTMLMediaElement) {
      return state(this).preservesPitch
    },
    set(this: HTMLMediaElement, value: boolean) {
      state(this).preservesPitch = value
    },
  },
  defaultPlaybackRate: {
    configurable: true,
    get(this: HTMLMediaElement) {
      return state(this).defaultPlaybackRate
    },
    set(this: HTMLMediaElement, value: number) {
      state(this).defaultPlaybackRate = value
    },
  },
  src: {
    configurable: true,
    get(this: HTMLMediaElement) {
      return this.getAttribute('src') ?? ''
    },
    set(this: HTMLMediaElement, value: string) {
      this.setAttribute('src', value)
      const loaded = state(this)
      Object.assign(loaded, { currentTime: 0, duration: Number.NaN, playbackRate: loaded.defaultPlaybackRate })
    },
  },
  play: {
    configurable: true,
    value(this: HTMLMediaElement) {
      state(this).paused = false
      return Promise.resolve()
    },
  },
  pause: {
    configurable: true,
    value(this: HTMLMediaElement) {
      state(this).paused = true
    },
  },
  load: {
    configurable: true,
    value(this: HTMLMediaElement) {
      Object.assign(state(this), { paused: true, currentTime: 0 })
    },
  },
})

// jsdom doesn't implement modal dialogs, pointer or drag events, or pointer capture.
HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.open = true
}
HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
  if (!this.open) return
  this.open = false
  this.dispatchEvent(new Event('close'))
}
class FakePointerEvent extends MouseEvent {
  pointerId: number
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
  }
}
window.PointerEvent ??= FakePointerEvent as unknown as typeof PointerEvent
// jsdom has no drag events either; without this, drag events lose their pointer position.
window.DragEvent ??= class extends MouseEvent {} as unknown as typeof DragEvent
Element.prototype.setPointerCapture = function () {}
Element.prototype.hasPointerCapture = function () {
  return false
}

beforeEach(() => {
  vi.spyOn(window, 'alert').mockImplementation(() => {})
  vi.spyOn(window, 'confirm').mockImplementation(() => true)
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})
