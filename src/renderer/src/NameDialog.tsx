import { useEffect, useRef, useState, type FormEvent } from 'react'

// Electron doesn't support window.prompt(), so naming playlists uses this modal instead.
interface NameDialogProps {
  heading: string
  submitLabel: string
  initialValue: string
  onSubmit: (name: string) => Promise<void>
  onClose: () => void
}

const maxNameLength = 100

export function NameDialog({ heading, submitLabel, initialValue, onSubmit, onClose }: NameDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    dialogRef.current?.showModal()
    inputRef.current?.select()
  }, [])

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return setError('Enter a name.')
    if (trimmed.length > maxNameLength) return setError(`Names can be up to ${maxNameLength} characters.`)
    setSaving(true)
    try {
      await onSubmit(trimmed)
    } catch (submitError) {
      // Electron wraps main-process errors as "Error invoking remote method '…': Error: <message>".
      const message = submitError instanceof Error ? submitError.message : 'Something went wrong.'
      setError(message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setSaving(false)
    }
  }

  return (
    <dialog ref={dialogRef} className="name-dialog" aria-labelledby="name-dialog-heading" onClose={onClose}>
      <form onSubmit={(event) => void handleSubmit(event)}>
        <h2 id="name-dialog-heading">{heading}</h2>
        <input
          ref={inputRef}
          value={name}
          maxLength={maxNameLength}
          aria-label="Playlist name"
          aria-invalid={error !== null}
          aria-describedby={error ? 'name-dialog-error' : undefined}
          onChange={(event) => {
            setName(event.target.value)
            setError(null)
          }}
        />
        {error && (
          <p id="name-dialog-error" className="name-dialog-error" role="alert">
            {error}
          </p>
        )}
        <div className="name-dialog-actions">
          <button type="button" className="small-action icon-action" onClick={() => dialogRef.current?.close()}>
            Cancel
          </button>
          <button type="submit" className="small-action primary-action" disabled={saving}>
            {submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  )
}
