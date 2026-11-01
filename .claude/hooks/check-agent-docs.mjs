// Stop hook: keeps the technical docs (agents in .claude/agents/, skills in .claude/skills/) in step with the code
// they describe.
//
// A technical doc lists the files it covers in the first column of its "## Files" table (paths in backticks; a
// path ending in "/" covers a whole folder). When Claude finishes a turn having changed covered files (uncommitted, or
// committed since the last check) without changing that doc, Claude is sent back once to update the doc or say
// why the change doesn't affect it.
//
// Each changed file is flagged once per doc: what's been flagged is remembered in the git folder (never committed)
// until the next commit, so unrelated edits to large shared files don't prompt on every turn.
// Anything unexpected (not a git repo, no docs, a git error) lets Claude stop as normal.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = process.env.CLAUDE_PROJECT_DIR || resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const agentsFolder = '.claude/agents'
const skillsFolder = '.claude/skills'

function git(...args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
}

function readStdin() {
  return new Promise((done) => {
    let text = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => (text += chunk))
    process.stdin.on('end', () => done(text))
  })
}

// Every technical doc, relative to the repo: each agent's .md file and each skill's SKILL.md.
function technicalDocs() {
  const list = (folder) => (existsSync(join(repo, folder)) ? readdirSync(join(repo, folder)) : [])
  const agents = list(agentsFolder)
    .filter((name) => name.endsWith('.md'))
    .map((name) => `${agentsFolder}/${name}`)
  const skills = list(skillsFolder)
    .map((name) => `${skillsFolder}/${name}/SKILL.md`)
    .filter((file) => existsSync(join(repo, file)))
  return [...agents, ...skills]
}

// The paths a doc covers: backticked entries in the first column of its "## Files" table.
function coveredPaths(markdown) {
  const section = /^## Files\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(markdown)?.[1] ?? ''
  const paths = new Set()
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue
    const firstCell = line.split('|')[1] ?? ''
    for (const [, path] of firstCell.matchAll(/`([^`\s]+)`/g)) paths.add(path)
  }
  return [...paths]
}

const isCovered = (file, paths) => paths.some((path) => (path.endsWith('/') ? file.startsWith(path) : file === path))

// Files changed in the working tree (including new and deleted files), relative to the repo.
function uncommittedChanges() {
  const entries = git('status', '--porcelain=v1', '-z', '--untracked-files=all').split('\0').filter(Boolean)
  const files = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    files.push(entry.slice(3))
    // A rename is followed by its old path, which changed too.
    if (entry[0] === 'R' || entry[0] === 'C') files.push(entries[++i])
  }
  return files
}

// Files changed by commits made since `since` (if it's still an ancestor of HEAD).
function committedSince(since, head) {
  if (!since || since === head) return []
  try {
    git('merge-base', '--is-ancestor', since, head)
    return git('diff', '--name-only', since, head).split('\n').filter(Boolean)
  } catch {
    return []
  }
}

try {
  const event = JSON.parse((await readStdin()) || '{}')
  if (event.stop_hook_active) process.exit(0)

  const head = git('rev-parse', 'HEAD').trim()
  const statePath = resolve(repo, git('rev-parse', '--git-path', 'claude-agent-docs-check.json').trim())
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {}
  const changed = [...new Set([...uncommittedChanges(), ...committedSince(state.checkedHead, head)])]
  // Once everything has been committed and checked, start afresh.
  const flagged = changed.length ? (state.flagged ?? {}) : {}

  const reminders = []
  for (const docFile of technicalDocs()) {
    const paths = coveredPaths(readFileSync(join(repo, docFile), 'utf8'))
    if (paths.length === 0 || changed.includes(docFile)) continue
    const unflagged = changed.filter((file) => isCovered(file, paths) && !flagged[docFile]?.includes(file))
    if (unflagged.length === 0) continue
    flagged[docFile] = [...(flagged[docFile] ?? []), ...unflagged]
    reminders.push(`- ${docFile} covers ${unflagged.join(', ')}`)
  }

  writeFileSync(statePath, JSON.stringify({ checkedHead: head, flagged }, null, 2))
  if (reminders.length === 0) process.exit(0)
  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason: [
        'Files described by a technical doc changed, but the doc did not:',
        ...reminders,
        'If the change alters how that feature works (flow, schema, constants, algorithms, file names, tests or ' +
          'pitfalls), update the doc now, as AGENTS.md requires. If it does not, say so briefly and finish.',
      ].join('\n'),
    }),
  )
} catch {
  // Never stop Claude from finishing because the check itself failed.
}
process.exit(0)
