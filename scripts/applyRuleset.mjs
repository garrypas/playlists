// Applies the branch ruleset in .github/rulesets/main.json to the GitHub repo of the current checkout, creating it or
// updating the ruleset with the same name. Needs the GitHub CLI logged in (`gh auth login`) as a repo admin.
//
//   node scripts/applyRuleset.mjs

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rulesetFile = resolve(root, '.github/rulesets/main.json')

const gh = (args, input) =>
  execFileSync('gh', args, { cwd: root, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'inherit'] })

const ruleset = JSON.parse(readFileSync(rulesetFile, 'utf8'))
const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim()
const existing = JSON.parse(gh(['api', `repos/${repo}/rulesets`, '--paginate']))
const match = existing.find((item) => item.name === ruleset.name)

const [method, path] = match ? ['PUT', `repos/${repo}/rulesets/${match.id}`] : ['POST', `repos/${repo}/rulesets`]
const saved = JSON.parse(gh(['api', '--method', method, path, '--input', '-'], JSON.stringify(ruleset)))
console.log(`${match ? 'Updated' : 'Created'} ruleset "${saved.name}" (id ${saved.id}) on ${repo}.`)
