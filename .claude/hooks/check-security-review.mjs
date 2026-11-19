// Stop hook: makes sure every set of changes gets a security review before Claude finishes (AGENTS.md, "Workflow for
// changes").
//
// When Claude finishes a turn and the repo has changes (uncommitted, or committed since the last check) that haven't
// been reviewed, Claude is sent back once to run the `security` subagent over them. A turn counts as reviewed when,
// since the user's last prompt, Claude ran the `security` subagent (Agent/Task tool) or the `security-review` skill.
//
// Changes are identified by a snapshot of the working tree's content (a git tree ID covering tracked and untracked,
// non-ignored files), remembered in the git folder (never committed). A snapshot is flagged at most once, a reviewed
// snapshot isn't flagged again, and committing reviewed work doesn't change it. Any new edit makes a new snapshot.
// Building the snapshot writes blobs to git's object store; they're unreferenced and `git gc` removes them.
// Anything unexpected (not a git repo, a git error, an unreadable transcript) lets Claude stop as normal.

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = process.env.CLAUDE_PROJECT_DIR || resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function git(args, env) {
  // Hooks run outside the sandbox, so a repo's core.fsmonitor setting must not get to run a command here.
  return execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'ignore'],
  })
}

const gitPath = (name) => resolve(repo, git(['rev-parse', '--git-path', name]).trim())

// The tree ID of the working tree as it is now, built in a scratch copy of the index so the real one is untouched.
function workingTreeSnapshot() {
  const index = gitPath(`claude-security-review-${process.pid}.index`)
  const realIndex = gitPath('index')
  try {
    if (existsSync(realIndex)) copyFileSync(realIndex, index)
    git(['add', '--all'], { GIT_INDEX_FILE: index })
    return git(['write-tree'], { GIT_INDEX_FILE: index }).trim()
  } finally {
    rmSync(index, { force: true })
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

const contentBlocks = (entry) => {
  const content = entry?.message?.content
  return Array.isArray(content) ? content : typeof content === 'string' ? [{ type: 'text', text: content }] : []
}

// A real prompt from the user, not a tool result, hook feedback or other injected message.
const isUserPrompt = (entry) =>
  entry?.type === 'user' &&
  !entry.isMeta &&
  contentBlocks(entry).some((block) => block.type === 'text' && !block.text.includes('Stop hook feedback'))

const isSecurityReview = (block) =>
  block.type === 'tool_use' &&
  (((block.name === 'Agent' || block.name === 'Task') && block.input?.subagent_type === 'security') ||
    (block.name === 'Skill' && block.input?.skill === 'security-review'))

// Whether Claude ran a security review since the user's last prompt.
function reviewedThisTurn(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return false
  const entries = readFileSync(transcriptPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return undefined
      }
    })
  let start = 0
  entries.forEach((entry, i) => isUserPrompt(entry) && (start = i))
  return entries
    .slice(start)
    .some((entry) => entry?.type === 'assistant' && contentBlocks(entry).some(isSecurityReview))
}

try {
  const event = JSON.parse((await readStdin()) || '{}')
  const statePath = gitPath('claude-security-review-check.json')
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {}
  const snapshot = workingTreeSnapshot()
  // First run: compare against the last commit, so a clean checkout isn't flagged.
  const seen = state.snapshot ?? git(['rev-parse', 'HEAD^{tree}']).trim()
  writeFileSync(statePath, JSON.stringify({ snapshot }, null, 2))

  // Nothing new, already reviewed this turn, or already sent back once (stop_hook_active): let Claude stop.
  if (snapshot === seen || event.stop_hook_active || reviewedThisTurn(event.transcript_path)) process.exit(0)

  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason:
        'These changes have not had a security review. As AGENTS.md requires, run the `security` subagent over ' +
        'the diff (uncommitted changes and any commits made in this task), fix what it finds and re-run the ' +
        'checks, or report findings that need the user. If the changes cannot affect security (for example ' +
        'wording-only edits to prose docs), say so briefly and finish.',
    }),
  )
} catch {
  // Never stop Claude from finishing because the check itself failed.
}
process.exit(0)
