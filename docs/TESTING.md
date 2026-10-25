# Testing Git++

## Commands

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Results from the delivery environment (Linux Debian 12, Node 24.22, Git 2.39.5):

| Command | Result |
| --- | --- |
| `npm run typecheck` | pass (strict) |
| `npm test` | 44 passed / 44, 9 files |
| `npm run build` | pass (renderer + main + preload + harness) |
| `npm run test:e2e` | 18/18 checks pass |
| `npm run package:win:unpacked:cross` | pass (Windows x64 unpacked) |
| `npm run package` (NSIS) | blocked: wine not installed |

## Unit tests (`tests/unit`)

- **status.test.ts** — porcelain v2 branch headers, staged/unstaged/renamed/conflicted/untracked records, unborn/detached HEAD, ignored entries and statistics.
- **diff.test.ts** — unified hunk parsing, line numbering, rename/new-file/binary metadata, single-hunk patch generation and empty diffs.
- **graph.test.ts** — lane assignment for linear/parallel histories, merge edges and missing parents.
- **errors.test.ts** — credential redaction and Git error classification (auth, network, local-change conflict, missing repository).
- **contract.test.ts** — Zod rejection of invalid/oversized payloads, required destructive confirmations, and absence of arbitrary command methods.
- **paths.test.ts** — spaces/Unicode, absolute paths, NUL bytes, traversal, symlink escape and safe creation.
- **settings.test.ts** — defaults, persistence, validation, AI consent gate, corrupt-file recovery, recents and token non-persistence.
- **github.test.ts** — HTTPS/SSH/scp remote parsing and rejection of non-GitHub hosts.

## Integration tests (`tests/integration/git.test.ts`)

Every test creates a temporary real Git repository (and removes it afterwards). Covered operations:

- `git init`, identity configuration, untracked status, staging, commits, log, historical file reads.
- Partial staging of one hunk with `git apply --cached --recount`, unstage, full discard.
- Branch create/switch/rename/delete, invalid branch names, protection of overlapping local changes.
- A genuine three-way merge conflict: base/ours/theirs inspection, refusal to continue unresolved, explicit conflict resolution, mark resolved, merge continuation and two-parent merge commit.
- Stash creation including untracked files, apply without dropping, drop.
- Worktree creation/list/removal with spaces and Unicode in the path, dirty-worktree protection and branch preservation.
- Cherry-pick and revert.
- Markdown file save/read/list with Unicode paths and traversal rejection.
- Missing repository and missing Git executable error codes.
- Preflight: suggested checks, command trust gating (skipped ≠ passed), real command execution, staged secret scan, and stale-result detection after the working tree changes.

Temporary fixtures are created with `fs.mkdtemp` under the OS temp directory and deleted in `afterEach`. The user's real repositories are never touched.

## End-to-end tests (`scripts/e2e.mjs`)

The Electron window requires a desktop session (GTK/X). This environment has neither. To still exercise the real UI and real Git engine, the repository includes a development-only harness:

- `src/main/harness/server.ts` composes the same `createApi()` used by Electron, serves the production renderer bundle, and injects a small bridge that maps `window.gitpp.invoke` to an HTTP RPC endpoint on `127.0.0.1`.
- Secrets use an in-memory store in harness mode. Dialogs are deterministic. The harness is **not** included in packaged builds.
- Playwright drives Chromium against the harness. All Git operations are executed by the real Git CLI through the real service layer.

The test creates a fresh fictional demo repository, then verifies:

1. Repository opens and the title bar shows it.
2. Changes shows real status entries.
3. Diff shows actual changed lines.
4. Staging updates the real index and the staged diff remains inspectable.
5. Commit creates a real commit (verified with `git log`).
6. Branch creation switches HEAD (verified with `git rev-parse`).
7. History shows the new commit and details.
8. Preflight runs real checks and reports statuses.
9. Markdown Studio saves the actual file on disk (verified from Node and `git show`).
10. Deleting the current branch fails safely with a visible error and no success toast.
11. Command palette navigates to Settings.
12. Light/dark themes apply.
13. No uncaught renderer errors occur.

Run it with the harness (the script starts its own):

```bash
npm run test:e2e
```

Playwright's Chromium needs system libraries. If the sandbox lacks them, install Playwright's dependencies on a normal machine (`npx playwright install --with-deps chromium`) or point `LD_LIBRARY_PATH`/`FONTCONFIG_FILE` at extracted packages. This limitation affects the test browser, not the app itself.

## Screenshots

`scripts/screenshots.mjs` generates a fresh demo repository and captures the actual renderer (Chromium harness, production bundle) in dark/light themes and major workspaces into `docs/screenshots/`. It is deliberately separate from `test:e2e` so screenshots reflect a clean, controlled demo state.

## Not covered

- Runtime verification inside the Electron shell (isolation flags are configured but not executed here).
- Windows-specific behaviours, installer execution and code signing.
- Real GitHub API calls (no token is configured; error paths are implemented and the UI shows genuine API errors when used).
- AI provider calls (no key is configured).
- Very large repositories beyond the bounded-output/truncation safeguards.
