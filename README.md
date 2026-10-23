# Git++ Desktop Client

> **Git but plus plus** — A modern, fast, and feature-rich desktop Git client with signature **Preflight Lab** testing and **Markdown Studio** editing capabilities.

![Git++ Changes Workspace](docs/screenshots/01_changes_workspace.png)

---

## Key Features & Highlights

### ⚡ Core Git Operations
- **Porcelain v2 Status Parsing**: Accurate staged, unstaged, untracked, modified, deleted, and conflicted file detection.
- **Unified & Side-by-Side Diffs**: High-resolution line-by-line diff inspector with hunk headers and add/delete highlighting.
- **Commit & Amend Composer**: Built-in commit message summary/description editor with amend support and git identity diagnostic warnings.
- **Interactive History Graph & Archaeology**: Visual commit graph with branch refs, parent hashes, search/filter, and instant commit hash copy.
- **Branches, Remotes & Synchronization**: Switch, create, and delete branches; fetch, pull, and safe push (`--force-with-lease`).
- **Advanced Workflows**: Stashes (list, save, apply, drop), merge, rebase, cherry-pick, revert, and conflict detection.

### 🛡️ Signature Feature: Preflight Lab
Help developers check and validate code before committing:
- **Profile Runner**: Executes type checks (`pnpm typecheck`), unit tests (`pnpm test`), builds (`pnpm build`), and secret scans (`git diff HEAD --check`).
- **Security Safeguards**: Explicit user authorization consent required before executing repository scripts.
- **Readiness Policy**: Configurable commit enforcement policy to block commits if required Preflight checks fail.
- **Log Inspector**: Real-time terminal output logs with duration, exit codes, and timestamps.

![Preflight Lab](docs/screenshots/03_preflight_lab.png)

### 📝 Signature Feature: Markdown Studio
- **Split-View Visual & Source Editor**: Live preview side-by-side with source text editing.
- **Safe HTML Sanitization**: Renders headings, lists, bold/italic, blockquotes, and code blocks safely.
- **Unsaved Changes Tracking**: Word/character counters and dirty state save indicators.

![Markdown Studio](docs/screenshots/04_markdown_studio.png)

### 🌌 Project Universe & Parallel Universes (Worktrees)
- **Project Universe**: Visual breakdown of language composition and dependency topology.
- **Parallel Worktrees**: Create, list, open, and remove Git worktrees to work on separate branches simultaneously without disturbing your primary working tree.

![Parallel Worktrees](docs/screenshots/06_worktrees.png)

### 🐙 GitHub Workspace & Application Settings
- **GitHub Integration**: Manage Pull Requests, Issues, and publish GitHub Releases with Personal Access Token authentication.
- **Settings & Theme**: Persistence for Dark/Light theme, custom Git binary executable path, Preflight policies, and GitHub tokens.

![Settings](docs/screenshots/07_settings.png)

---

## Technical Stack & Architecture

- **Desktop Core**: Electron 29 (`contextIsolation: true`, `nodeIntegration: false`, sandbox enabled)
- **Frontend**: React 18, TypeScript (strict checking), Tailwind CSS, Lucide React Icons
- **Bundler & Tooling**: Vite 5, PostCSS, Autoprefixer
- **IPC Validation**: Zod type schemas (`src/shared/ipc.ts`)
- **Testing**: Vitest for unit tests, Playwright for end-to-end verification
- **Packaging**: `electron-builder` targeting Windows (`Git++.exe` output)

---

## Development & Build Instructions

### Prerequisites
- Node.js v18+
- `pnpm` package manager
- Git executable installed and available in PATH

### Commands

```bash
# 1. Install dependencies
pnpm install

# 2. Start Vite development server
pnpm dev

# 3. Execute unit test suite
pnpm test

# 4. Run TypeScript type checking
pnpm typecheck

# 5. Compile production build
pnpm build

# 6. Package for Windows (Generates dist/win-unpacked/Git++.exe)
pnpm package
```

---

## Verification & Proof Screenshots

Screenshots captured from the running application are saved in `docs/screenshots/`:
1. `docs/screenshots/01_changes_workspace.png`: Changes & File Staging Workspace
2. `docs/screenshots/02_history_graph.png`: Branch Commit History & Archaeology
3. `docs/screenshots/03_preflight_lab.png`: Preflight Lab Execution & Suite Dashboard
4. `docs/screenshots/04_markdown_studio.png`: Markdown Studio Split Editor
5. `docs/screenshots/05_project_universe.png`: Project Universe Language & Dependency Topology
6. `docs/screenshots/06_worktrees.png`: Parallel Worktrees Management
7. `docs/screenshots/07_settings.png`: Application Settings & Theme Switcher

---

## License & Hygiene

Licensed under MIT. All test artifacts, dependency outputs, and build output directories (`dist/`, `node_modules/`) are ignored in `.gitignore`.
