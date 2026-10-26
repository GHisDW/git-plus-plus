# Git++ architecture

Git++ is a single-package Electron application with three runtime surfaces:

1. **Main process** — owns all filesystem, process, credential and network access.
2. **Preload** — exposes a narrow, typed bridge through `contextBridge`.
3. **Renderer** — React UI with no Node.js or direct filesystem access.

A fourth, non-shipping surface (the browser harness) runs the same renderer and the same API in Chromium for automated testing and screenshots.

```
┌──────────────────────────── Renderer (sandboxed) ────────────────────────────┐
│ React workspaces, command palette, diff viewer, markdown preview            │
│                  window.gitpp.invoke(method, payload)                        │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ contextBridge / IPC
┌──────────────────────────────────▼──────────────────────────────────────────┐
│ Preload: typed invoke + event subscription + window controls                │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ ipcMain (sender + senderFrame checked)
┌──────────────────────────────────▼──────────────────────────────────────────┐
│ createApi().invoke — Zod validation, error normalisation                   │
│  ├─ GitService ── GitRunner ── runProcess (no shell, timeout, output bound) │
│  ├─ SettingsStore ── SecretStore (safeStorage)                              │
│  ├─ PreflightService ── runProcess (consent-gated, cancellable)             │
│  ├─ GithubService (REST, token from SecretStore)                            │
│  └─ AiService (opt-in, consent-gated)                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Source layout

| Path | Responsibility |
| --- | --- |
| `src/shared/types.ts` | IPC result types and domain models |
| `src/shared/contract.ts` | Zod schemas for every API method; single source of payload validation |
| `src/shared/status.ts` | Porcelain v2 parser |
| `src/shared/diff.ts` | Unified diff parser and hunk patch builder |
| `src/shared/graph.ts` | Commit lane/edge computation |
| `src/shared/errors.ts` | Error factories and credential redaction |
| `src/main/process.ts` | Bounded, cancellable child-process runner |
| `src/main/git/GitService.ts` | Every Git operation used by the UI |
| `src/main/git/GitRunner.ts` | Git CLI wrapper, version detection, config flags |
| `src/main/git/errors.ts` | Git stderr → actionable application errors |
| `src/main/git/paths.ts` | Repo-relative path validation, traversal/symlink protection |
| `src/main/git/parse.ts` | Branch/tag/stash/worktree/config/log parsers |
| `src/main/api.ts` | Transport-independent API composition + Zod dispatch |
| `src/main/index.ts` | Electron security policy, window, IPC registration, menu |
| `src/main/services/settings.ts` | Validated, atomic settings and recents persistence |
| `src/main/services/secrets.ts` | safeStorage-backed encrypted secret store (memory fallback) |
| `src/main/services/preflight.ts` | Check configuration, execution, cancellation, staleness |
| `src/main/services/github.ts` | GitHub REST integration |
| `src/main/services/ai.ts` | OpenAI-compatible provider client |
| `src/main/harness/server.ts` | Test/screenshot transport (not packaged) |
| `src/preload/index.ts` | The only bridge between renderer and main |
| `src/renderer/**` | UI, state, components, workspaces, design tokens |
| `tests/**` | Unit and real-repository integration tests |
| `scripts/**` | Build, dev, demo repo, screenshots, e2e |

## Request lifecycle

1. Renderer calls `window.gitpp.invoke('git.commit', payload)` (typed by `ApiResults`/`ApiParams`).
2. Preload forwards to `ipcMain` channel `gitpp:invoke` with `{ method, payload }`.
3. Main checks the sender is the main window's main frame, then confirms the method exists in `API_METHODS`.
4. `createApi().invoke` parses the payload with the method's Zod schema. Unknown keys are ignored by Zod objects; invalid shapes/enums/limits are rejected.
5. The typed handler calls services. Services validate repository-relative paths and revisions again (defence in depth).
6. Git is spawned with an argument array, `shell: false`, `windowsHide`, a timeout, bounded stdout/stderr, and redacted stderr. On failure the stderr is translated into a stable error code with a human hint.
7. Results cross the IPC boundary as `{ ok: true, data }` or `{ ok: false, error }`. Exceptions never cross raw.
8. Renderer surfaces errors as error toasts with copyable detail; success is shown only after the API returns.

## Git operation details

- **Status**: `git status --porcelain=v2 --branch -z --untracked-files=all --find-renames`. Branch headers, renames, conflicts and untracked files are parsed in `shared/status.ts`.
- **Diffs**: `git diff --no-color --no-ext-diff -M --unified=N` for worktree/staged, `git show` for commits, `git diff a..b` for ranges, `git stash show -p` for stashes. Untracked files are read explicitly and rendered as additions (bounded). `core.quotePath=false` avoids octal-mangled Unicode paths.
- **Hunk staging**: the parser reconstructs a minimal patch for the selected hunk. `git apply --cached --recount` applies it; unstage uses `--reverse`. This is real index manipulation, not a UI-only state.
- **Commits**: message passed on stdin via `git commit -F -`, never interpolated into a shell. Staged-file presence is checked first; Git++ never auto-stages.
- **Branches**: `git switch`, `git branch -m/-d/-D`, `git branch --set-upstream-to`. Before switching, Git++ computes the overlap between dirty files and files changed on the target branch and refuses with an explanation if Git would overwrite local work.
- **History**: `git log --topo-order` with NUL/US-separated fields; refs come from `%D`; lanes are computed in the renderer from actual parent hashes. Stash/notes refs are excluded from the default all-branch view.
- **Worktrees**: `git worktree list --porcelain`, `add`, `remove`, `prune`; each worktree's dirty state is probed with its own `git status`. Removing a dirty worktree requires an explicit force confirmation.
- **Conflicts**: conflicted paths come from status; base/ours/theirs are fetched with `git show :1:path`, `:2:`, `:3:`. Mark resolved runs `git add`, but refuses if conflict markers remain. Continue/abort call the corresponding Git command and report the real result.
- **Merge commits**: commit details use `git show` for normal commits and the first-parent range for merge commits so file lists are meaningful.

## State and persistence

Settings and recents are JSON files in Electron's `userData` directory (`GITPP_DATA_DIR` overrides this for development/testing):

- `settings.json` — validated preferences; atomic temp-file + rename writes.
- `recent-repositories.json` — paths, pin state, last-opened time; never modifies folders.
- `preflight.json` — per-repository check configuration.
- `secrets/*.bin` — safeStorage-encrypted GitHub/AI credentials (never plaintext).

Corrupted JSON is renamed to `*.corrupt-<timestamp>` and defaults are restored with a warning. Renderer preferences such as the last workspace are kept in `localStorage`; all sensitive state lives in main.

## Renderer state

`AppProvider` holds the app info, settings, recents, current repository snapshot, toasts, busy state, workspace selection and palette state. Operations go through `runOperation`, which shows a busy indicator, normalises errors, applies returned snapshots and refreshes the repository. The snapshot refresh is also triggered on window focus and every 25 seconds, so changes made outside Git++ appear without a manual reload.

## Preflight

Checks are classified as read-only internal checks (`status`, `conflicts`, `secret-scan`) or configured commands. Commands are skipped unless the repository configuration explicitly grants trust; skipped is never reported as passed. Each run records branch/HEAD/fingerprint, durations, exit codes, bounded output and a stale flag computed by re-fingerprinting the repository. Runs are cancellable and duplicate concurrent runs for one repository are coalesced.

## Test harness (non-shipping)

`src/main/harness/server.ts` exposes the same `createApi()` over local HTTP and serves the production renderer bundle with an injected bridge. It binds to `127.0.0.1`, uses an in-memory secret store and is not included in the Electron build (only in `dist/harness`). It exists because the CI environment has no display/GTK stack; the renderer code, API handlers, Git engine and validation are identical to the desktop path. The Electron main process still needs to be exercised on a Windows desktop before release.
