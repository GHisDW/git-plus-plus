# Security and privacy review

Git++ is not certified or guaranteed secure. This document describes the controls that were implemented, the checks actually performed, and the residual risks.

## Implemented controls

### Electron isolation
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webviewTag: false`, `nodeIntegrationInWorker: false`.
- Renderer has no `require`, no `process` filesystem access, no direct Git or network access.
- Preload exposes only `invoke`, an event subscription, platform/transport metadata and window controls for the custom title bar.
- IPC handlers verify the sender is the main window's **main frame**; frames that are not the top-level window are rejected.
- New windows are denied; navigation away from the app origin is prevented; webview attachment is prevented; permission requests/checks are denied.
- A Content-Security-Policy is applied to every response (`script-src 'self'`, `object-src 'none'`, `frame-src 'none'`, `base-uri 'none'`, no remote connect-src in production).

### IPC and validation
- Every method and payload is validated with Zod (`src/shared/contract.ts`). Method names are allow-listed; unknown methods are rejected before reaching handlers.
- There is **no** generic command-execution, shell, filesystem or “open URL” RPC available to the renderer. `app.openExternal` validates `http(s)`/`mailto`, rejects localhost and passes the final URL to `shell.openExternal`.
- Destructive calls require explicit typed confirmations (`confirmation: 'abort'`, `'discard'`, `'remove-worktree'`) and UI confirmation dialogs; forced worktree/branch removal also requires a typed phrase.
- Errors are structured, bounded and credential-redacted before crossing the boundary.

### Process execution
- Git is spawned with an argument array, `shell: false`, `windowsHide: true`, a timeout and bounded stdout/stderr. No string concatenation of untrusted values.
- Environment disables interactive prompts (`GIT_TERMINAL_PROMPT=0`), pager and editor; credentials are not passed by Git++.
- Timeouts/cancellation terminate the child process tree (POSIX process group / Windows `taskkill /T /F`).
- Repository scripts are **never executed on open**. Preflight command checks require per-repository trust plus a confirmation dialog; status/conflict/secret-scan checks only use read-only Git or in-process logic.
- A worktree is not a sandbox. The UI and documentation state that running repository commands executes untrusted code with the user's permissions.

### Paths and files
- Renderer-supplied paths are repository-relative. Absolute paths, drive-qualified paths, UNC paths and NUL bytes are rejected.
- Resolution uses real paths and rejects traversal (`..`) and symlink escapes outside the repository.
- Markdown saving is restricted to text/Markdown extensions, bounded in size, written atomically, and guarded by an expected mtime/size version to avoid clobbering external edits. Overwriting an externally changed file requires an explicit confirmation.
- Deleting an untracked file requires a confirmation that names the file and explains it cannot be restored by Git.
- Removing a worktree uses `git worktree remove` and requires force confirmation when dirty. Git++ never recursively deletes a worktree folder itself.
- Removing a recent repository entry only edits `recent-repositories.json`.

### Credentials and secrets
- GitHub tokens and AI keys are stored with Electron `safeStorage` (DPAPI/Keychain/libsecret) under `userData/secrets`; files are written with restrictive permissions and removed on disconnect.
- Tokens/keys are never written to `settings.json`, logs, toasts or error details. HTTP headers are never logged.
- `redact()` masks token formats, authenticated URLs, bearer/authorization headers, AWS/OpenAI/GitHub token patterns and password-like assignments in errors and stderr. Git stdout is not globally redacted because it is repository content (diffs must be accurate); it is only rendered locally.
- If OS encryption is unavailable, secrets are kept in memory only for the session and a startup warning is shown. There is no plaintext-disk fallback.
- No telemetry, analytics, crash reporting or diagnostics upload exists. `settings.privacy.sendDiagnostics` is a literal `false`.

### Untrusted content
- Repository status, filenames, diffs, commit messages, Markdown and command output are treated as data.
- React escapes text nodes. Markdown preview uses `marked` + DOMPurify with scripts/styles/iframes/forms and event-handler attributes forbidden; only http(s)/mailto/# URIs are allowed. External images are additionally blocked by the production CSP.
- Links in Markdown are intercepted; remote links are validated and opened externally, relative links are not navigated inside the embedded preview.
- Diff rendering is bounded (patch/file sizes, file counts) to avoid freezing the UI on hostile or huge content.

## Checks actually performed

- `npm run typecheck` (strict TypeScript) — passed.
- `npm test` — 44 tests passed, including:
  - IPC contract rejects invalid targets, missing confirmations and oversized payloads; asserts there is no exec/shell/spawn method.
  - Path tests for `..`, absolute POSIX/Windows paths, NUL bytes, symlink escape and Unicode/space paths.
  - Redaction tests for authenticated URLs, GitHub/OpenAI tokens, passwords and Authorization headers.
  - Git error classification for auth/network/conflict/missing-repository cases.
  - Real-repository integration tests that verify conflict handling does not auto-resolve, worktrees cannot be removed dirty without force, and branches with worktrees are not force-deleted silently.
- `npm run test:e2e` — 18/18 checks passed, including an intentionally failing Git operation that produced an error toast and no success toast.
- Manual review of the Electron window options, IPC registration, CSP strings, process spawning and Markdown sanitisation configuration.
- Secret scanning of the repository/history was performed before delivery (`git grep`/manual review); no credentials are committed. `settings.json`/secret files live outside the repo and are gitignored where applicable.

## Not performed / limitations

- The **Electron window was not executed** in this environment (no display/GTK). Electron-level behaviours (actual context isolation, safeStorage on Windows, title bar/DPI) were reviewed and configured but not runtime-verified here. The Chromium harness verifies the renderer and main-process API, not the Electron wrapper itself.
- No penetration test, fuzzing campaign, external security audit or code signing was performed. The app is not “certified secure”.
- Windows-specific credential manager and path-casing edge cases need validation on Windows.
- Git hooks, credential helpers and user-configured filters run as part of legitimate Git commands and are outside Git++'s isolation. Users should only open repositories they trust.
- Extensions/plugins do not exist; optional GitHub/AI requests are explicitly user-triggered and sent from the main process.
- Electron/Chromium vulnerabilities are inherited from the pinned runtime; update Electron before distributing widely.

## Reporting

This is a demonstration project. For a real deployment, add a private security contact, a disclosure policy, dependency scanning in CI, signed releases, and a Windows test matrix.
