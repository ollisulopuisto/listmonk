# CLAUDE.md

**`GEMINI.md` is the authoritative instruction file for this repo.** Read it before
doing any non-trivial work here. This file exists because Claude Code auto-loads
`CLAUDE.md` but not `GEMINI.md`, so the highest-stakes rules are repeated inline
below. Everything else — the full PR workflow, editor file list, and sync
strategy — lives in `GEMINI.md`. If the two ever disagree, `GEMINI.md` wins.

This is a **private fork** of `knadh/listmonk` with deliberate divergences from
upstream. It is not a staging area for upstream contributions.

## 1. PRs go to the fork, never upstream (`GEMINI.md` §4)

Always open PRs against `ollisulopuisto/listmonk`. **Never** `knadh/listmonk`.

`gh pr create` defaults its base repo to the **parent** repo when run inside a
fork, so `--base master` alone resolves to *upstream's* master. Pass the repo
explicitly:

```
gh pr create --repo ollisulopuisto/listmonk --base master --head <branch> ...
```

Verify the returned URL points at `ollisulopuisto/listmonk`. If a PR lands
upstream by mistake, close it immediately with
`gh pr close <n> --repo knadh/listmonk` and reopen against the fork.

The same applies to issues, comments, and any other outward-facing `gh` action:
do not aim them at upstream without an explicit request.

## 2. Never overwrite the editor with upstream's TinyMCE (`GEMINI.md` §6)

This fork replaced upstream's TinyMCE with Tiptap. When syncing, resolve editor
conflicts in favour of **ours**. Protected files:

- `frontend/src/components/{Editor,RichtextEditor,MarkdownEditor,EmailMarkdownEditor,VisualEditor,CodeEditor}.vue`
- `frontend/email-builder/`
- `frontend/package.json` (Tiptap / emailmd / mjml-browser stack — no `tinymce`)

After any sync, verify these are unchanged and that `grep -r tinymce frontend/src`
returns nothing.

## 3. Migration versions can silently skip (`GEMINI.md` §8)

Migrations run only when their version sorts **above** the version recorded in the
DB (`cmd/upgrade.go`, `semver.Compare`). This fork carries its own migration
versions (`v6.3.0`, `v6.4.0`, `v6.5.0`) alongside upstream's, which creates two
hazards:

1. If upstream adds statements to an **older** migration (e.g. `v6.2.0`), they will
   never run on a fork DB already past that version. Copy them into a new
   fork-local migration.
2. If upstream ever ships a version this fork already used, the versions collide.

Check `git diff <last-sync>..upstream/master -- internal/migrations/` on every sync.

Note: `cmd` cannot host tests — `main.go`'s `init()` exits without a `config.toml`,
so adding any `*_test.go` there breaks `go test ./...`.

## 4. Branch and verify

Never commit directly to `master`; branch as `feat/`, `fix/`, or `refactor/`.
Upstream syncs merge with a **real merge commit**, not a squash — squashing is what
left `merge-base` stale and made a later sync report 83 phantom pending commits.

Before pushing, run: `go build ./...`, `go vet ./...`, `go test ./...`,
and in `frontend/`: `yarn build`, `yarn lint`.
