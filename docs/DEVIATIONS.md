# Implementation notes and deviations

- **Browser harness instead of Electron screenshots.** The build environment has no display/GTK stack, so the Electron window could not be launched. The renderer, preload contract equivalent and the real API/Git engine were exercised in Chromium. The harness is excluded from the packaged app and documented as a test aid. Electron security options remain configured for production.
- **No bundling of Git.** Git++ uses the installed Git executable, as required for genuine behaviour, credential helpers and hooks.
- **Pull is fast-forward only.** This avoids silent merges. Merge/rebase remain available as explicit operations.
- **Diff hunk staging uses `git apply --cached --recount`.** This is real index manipulation; untracked files and binary changes are staged as whole files because a partial patch is not meaningful there.
- **Preflight results are session-scoped.** Configuration persists; run results are kept in memory and marked stale when the working tree/HEAD changes.
- **GitHub PR detail is summary-only.** Full reviews/comments/checks open on GitHub; list/create operations are genuine REST calls.
- **AI is opt-in and limited to diff/commit actions.** No repository content is sent automatically.
- **Custom title bar.** On Windows the window uses a hidden title bar with renderer-provided minimise/maximise/close controls; native overlay controls are intentionally not used.
- **Packaging.** `electron-builder` is configured for Windows x64 NSIS, ZIP and unpacked output. Cross-building the NSIS installer requires Wine, which is unavailable here. The unpacked app and a ZIP distributable were produced successfully with executable signing/resource editing disabled; the NSIS installer was not produced.
