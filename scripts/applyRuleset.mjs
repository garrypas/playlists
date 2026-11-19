// Applies the repo's merge protection to the GitHub repo of the current checkout. Needs the GitHub CLI logged in
// (`gh auth login`) as a repo admin.
//
//   node scripts/applyRuleset.mjs
//
// - Creates the branch ruleset in .github/rulesets/main.json, or updates the ruleset with the same name.
// - Requires a maintainer to approve workflow runs for every outside contributor's PR. A fork PR's workflows could
//   otherwise report a fake check with the name of a required one (`Approval`, `Check (...)`).

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

// One "id<TAB>name" line per ruleset, across every page.
const existing = gh(['api', `repos/${repo}/rulesets`, '--paginate', '--jq', '.[] | [.id, .name] | @tsv'])
  .split('\n')
  .filter(Boolean)
  .map((line) => line.split('\t'))
const matchId = existing.find(([, name]) => name === ruleset.name)?.[0]

const [method, path] = matchId ? ['PUT', `repos/${repo}/rulesets/${matchId}`] : ['POST', `repos/${repo}/rulesets`]
const saved = JSON.parse(gh(['api', '--method', method, path, '--input', '-'], JSON.stringify(ruleset)))
console.log(`${matchId ? 'Updated' : 'Created'} ruleset "${saved.name}" (id ${saved.id}) on ${repo}.`)

try {
  gh(
    ['api', '--method', 'PUT', `repos/${repo}/actions/permissions/fork-pr-contributor-approval`, '--input', '-'],
    JSON.stringify({ approval_policy: 'all_external_contributors' }),
  )
} catch {
  console.error('The ruleset is saved, but setting workflow approval for outside contributors failed. Run this again.')
  process.exit(1)
}
console.log('Workflow runs from outside contributors now need a maintainer to approve them.')
