@AGENTS.md

# Claude Code extras

`AGENTS.md` (imported above) is the project guide and wins if anything here disagrees. This file only covers what is specific to Claude Code.

- **Subagents and skills:** the reference docs in `.claude/agents/` run as subagents (`product`, `database-design`, `data-api`, `security`). Ask them to answer, plan, review or diagnose work in their area instead of scanning the code. Load the `audio-engine` skill before playback work, the `tempo-and-key` skill before BPM or key work, and the `frontend-design` skill (plugin enabled in `.claude/settings.json`) before UI work.
- **Hooks** (registered in `.claude/settings.json`):
  - `.claude/hooks/guard-outside-repo.mjs` — PreToolUse hook that makes Claude Code ask before writing outside this repo or running unsandboxed shell commands.
  - `.claude/hooks/check-agent-docs.mjs` — Stop hook that sends Claude back once when files a technical doc covers changed but the doc didn't (`AGENTS.md`, "Workflow for changes" step 5).
- **Ralph loops:** do the loop in `AGENTS.md` step 1 with the `ralph-loop` plugin (enabled in `.claude/settings.json`). Start one with `/ralph-loop "<task, with its done criteria>" --completion-promise "DONE" --max-iterations 20`. Output `<promise>DONE</promise>` only when the done criteria are all true, never to escape the loop. Cancel with `/cancel-ralph`.
