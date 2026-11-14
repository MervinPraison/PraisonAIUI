# CLAUDE.md

Claude Code reads this file. The shared instructions for every agent are in
`AGENTS.md`, imported here:

@AGENTS.md

## Claude Code only

- Use the repo skills in `.claude/skills/` for their workflows: `aiui-change`, `aiui-pr-review`, `aiui-release`, `aiui-design`.
- Parallel agents each work in their own git worktree (`git worktree add --no-track -b <branch> <path> origin/main`), never in a checkout another agent is using.
- Never push to `main`. Every change goes through a pull request and the pipeline.
- Before any push, run `git branch -vv` and read the upstream in brackets. A branch created from `origin/main` tracks it unless you pass `--no-track`, and a branch tracking `origin/main` once pushed work straight to main. Fix it with `git branch --unset-upstream`, then `git push -u origin <branch>`.
