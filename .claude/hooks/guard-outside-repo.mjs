// PreToolUse guard: Claude must ask before changing anything outside this repository.
//
// - Write / Edit / NotebookEdit on a path outside the repo (after resolving relative paths, `~`, `..` and symlinks)
//   asks the user instead of going ahead.
// - Bash commands run outside the sandbox (dangerouslyDisableSandbox) could write anywhere, so they ask too. Sandboxed
//   commands can already only write inside the repo and temp folders.
// - Anything the hook can't make sense of asks rather than allowing.

import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function ask(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason },
    }),
  )
  process.exit(0)
}

// The real path of `path`, following symlinks. Files that don't exist yet resolve through their nearest existing
// folder, so a new file inside a symlinked folder is still judged by where it really lands.
function realPath(path) {
  try {
    return realpathSync.native(path)
  } catch {
    const parent = dirname(path)
    return parent === path ? path : join(realPath(parent), basename(path))
  }
}

function readStdin() {
  return new Promise((done) => {
    let text = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => (text += chunk))
    process.stdin.on('end', () => done(text))
  })
}

let event
try {
  event = JSON.parse(await readStdin())
} catch {
  ask("Repo guard couldn't read the tool request, so it needs your approval.")
}

const repo = realPath(process.env.CLAUDE_PROJECT_DIR || resolve(dirname(fileURLToPath(import.meta.url)), '../..'))
const tool = event.tool_name ?? ''
const input = event.tool_input ?? {}

if (tool === 'Bash') {
  if (input.dangerouslyDisableSandbox) ask(`This command runs outside the sandbox and could change files outside ${repo}.`)
  process.exit(0)
}

const path = input.file_path || input.notebook_path
if (typeof path !== 'string' || !path) ask(`Repo guard couldn't tell which file ${tool} would change.`)

const expanded = path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path
const target = realPath(resolve(event.cwd || repo, expanded))
const fromRepo = relative(repo, target)
if (fromRepo.startsWith('..') || isAbsolute(fromRepo)) {
  ask(`${tool} would change ${target}, which is outside this repository (${repo}).`)
}
