# Troubleshooting

## “Git is not available” / GIT_NOT_FOUND

- Install Git 2.23+ from <https://git-scm.com/downloads>.
- Ensure `git --version` works in the same environment that launches Git++.
- In **Settings → Git executable**, enter an absolute path (for example `C:\Program Files\Git\cmd\git.exe`) and press **Test & save**. Git++ validates it before storing.
- Git++ never downloads Git automatically.

## Authentication fails for fetch/pull/push

Git++ sets `GIT_TERMINAL_PROMPT=0`, so Git cannot ask interactively. Configure your normal credential helper or SSH agent outside Git++:

```bash
git config --global credential.helper manager   # Windows Git Credential Manager
git config --global user.name "Your Name"
git config --global user.email you@example.com
```

Git++ does not store Git passwords. If a remote requires a token, configure it in your credential helper or use an SSH URL. The error toast includes Git’s stderr and a hint; copy it for details.

## Pull says “not possible to fast-forward”

Git++ intentionally uses `git pull --ff-only` to avoid silent merge commits. If the branches diverged, merge or rebase deliberately from the Branches/History workspaces, then push.

## Force push is rejected

Force push uses `--force-with-lease` and requires typing the branch name. It fails if the remote moved since your last fetch. Fetch again and review the divergence; never force-push shared branches without coordination.

## “Branch already checked out” when creating a worktree

Git allows a branch to be checked out in only one worktree at a time. Create a new branch for the new worktree or use a branch that is not currently checked out. Remove the other worktree only if you understand its uncommitted changes.

## Worktree removal fails

Git refuses to remove a worktree with uncommitted changes or untracked files. Commit/stash the work, or explicitly enable **Force removal**. Git++ never deletes the folder itself. If the folder is already gone, use **Prune** to clean metadata.

## Merge/rebase/cherry-pick stopped with conflicts

Open **Changes → Resolve conflicts**. Inspect base/current/incoming, edit the result, Save, then Mark resolved. Continue is disabled/failing until Git reports no unresolved paths. You can always Abort with explicit confirmation.

## Conflict markers remain after editing

Git++ refuses to mark a file resolved while `<<<<<<<`, `=======` or `>>>>>>>` markers are present. Remove them and save again. Opening a file alone never marks it resolved.

## Markdown save says “file changed on disk”

Another program modified the file after you opened it. Reload to get the external version, or use **Overwrite with my version** after reviewing the warning. Git++ never silently clobbers external edits.

## Settings look damaged or the app falls back to defaults

Corrupt JSON is backed up as `settings.json.corrupt-<timestamp>` in the app data folder and defaults are restored with a warning. Use **Settings → Reset to defaults** (explicit confirmation) if needed. Tokens are not deleted by a settings reset.

## GitHub workspace says authentication failed

- Token expired/insufficient scopes: replace it in Settings → GitHub.
- Classic tokens generally need `repo`; add `workflow` for Actions.
- Fine-grained tokens need Contents (read), Pull requests (read/write), Issues (read/write), Actions (read).
- Enterprise: set the API base URL in Settings.
- Rate limits: the error includes the reset time. Local Git is unaffected.

## AI actions are disabled

AI requires all of: enabled toggle, consent acknowledgement, a stored API key, and a valid HTTPS (or localhost) base URL. The provider must expose an OpenAI-compatible `/chat/completions` endpoint. Suggestions are never applied automatically.

## Blank page after starting the packaged app

- Check that `dist/renderer/index.html` exists in the packaged `resources/app.asar`.
- Run the unpacked app with DevTools enabled in a development build to inspect console/CSP errors.
- Do not open the HTML file directly in a browser; the preload bridge is required.

## Running tests or screenshots headlessly

- This repository's CI environment lacked GTK/X and font libraries. The harness uses Chromium locally; install dependencies with `npx playwright install --with-deps chromium` on a normal machine.
- If you must run in a minimal container, extracted Debian libraries plus `LD_LIBRARY_PATH` and `FONTCONFIG_FILE` can make headless Chromium work, as was done for these screenshots. This is a test-environment workaround, not an app requirement.
- The Electron window itself needs a desktop session (or Xvfb with GTK libraries). It was not available in this environment.

## Windows installer build fails on Linux with “wine is required”

Building the NSIS installer and editing Windows executable resources requires Wine. Use Windows, a Wine-enabled CI runner, or build the unpacked app with:

```bash
npm run package:win:unpacked:cross
```

That does not produce a signed installer and omits executable icon/version resource editing.
