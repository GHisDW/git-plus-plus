#!/usr/bin/env python3
"""Create a disposable fictional repository with realistic history for demo/screenshots."""
import os
import shutil
import subprocess
from pathlib import Path

ROOT = Path(os.environ.get('GITPP_DEMO_ROOT', '.demo/gitpp-demo')).resolve()
WORKTREE = Path(os.environ.get('GITPP_DEMO_WORKTREE', str(ROOT.parent / f'{ROOT.name}-worktree'))).resolve()
shutil.rmtree(ROOT, ignore_errors=True)
shutil.rmtree(WORKTREE, ignore_errors=True)
ROOT.mkdir(parents=True)

ENV = {**os.environ, 'GIT_CONFIG_NOSYSTEM': '1'}


def git(*args, cwd=ROOT):
    return subprocess.run(['git', *args], cwd=cwd, env=ENV, check=True, capture_output=True, text=True).stdout.strip()


def write(path, content):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.strip() + '\n', encoding='utf-8')


def commit(subject, files, day):
    for path, content in files.items():
        write(path, content)
    git('add', '-A')
    stamp = f'2026-09-{day:02d}T10:30:00+02:00'
    env = {**ENV, 'GIT_AUTHOR_DATE': stamp, 'GIT_COMMITTER_DATE': stamp}
    subprocess.run(['git', 'commit', '-m', subject], cwd=ROOT, env=env, check=True, capture_output=True)


git('init', '-b', 'main')
git('config', 'user.name', 'Avery Chen')
git('config', 'user.email', 'avery.chen@example.test')

readme_v1 = '''
# Northstar Desktop

A fictional sample project used to demonstrate Git++.

## Getting started

```bash
npm install
npm run dev
```

See [the guide](docs/guide.md) for architecture notes.
'''

guide_v1 = '''
# Architecture guide

Northstar is a fictional Electron application used in Git++ demonstrations.

## Layers

- **Main process** owns repository access.
- **Preload** exposes a narrow, typed bridge.
- **Renderer** renders the interface.

## Conventions

| Area | Rule |
| --- | --- |
| Commits | Conventional Commits |
| Tests | Vitest |
| Icons | Lucide |
'''

app_v1 = '''
import { createTheme } from './theme';

export interface Project {
  id: string;
  name: string;
  archived: boolean;
}

export function activeProjects(projects: Project[]): Project[] {
  return projects.filter((project) => !project.archived);
}

const theme = createTheme('dark');
console.log('Northstar ready', theme.accent);
'''

theme_v1 = '''
export interface Theme {
  name: 'dark' | 'light';
  accent: string;
}

export function createTheme(name: 'dark' | 'light'): Theme {
  return { name, accent: name === 'dark' ? '#7e9cff' : '#3f63e0' };
}
'''

commit('chore: initial project scaffold', {
    'README.md': readme_v1,
    'package.json': '{\n  "name": "northstar-desktop",\n  "private": true,\n  "version": "1.0.0",\n  "scripts": {\n    "dev": "vite",\n    "build": "vite build",\n    "typecheck": "tsc --noEmit",\n    "test": "vitest run"\n  }\n}',
    '.gitignore': 'node_modules/\ndist/\n.env\n*.log\n',
    'src/app.ts': app_v1,
    'src/theme.ts': theme_v1,
    'docs/guide.md': guide_v1,
}, 1)

app_v2 = app_v1.replace(
    "  archived: boolean;\n}",
    "  archived: boolean;\n  updatedAt: string;\n}",
).replace(
    "const theme = createTheme('dark');",
    "export function sortByRecent(projects: Project[]): Project[] {\n  return [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));\n}\n\nconst theme = createTheme('dark');",
)
commit('feat: add project filtering helpers', {'src/app.ts': app_v2}, 2)

app_v3 = app_v2.replace(
    "  return projects.filter((project) => !project.archived);",
    "  if (!Array.isArray(projects) || projects.length === 0) return [];\n  return projects.filter((project) => !project.archived);",
)
commit('fix: guard empty project lists', {'src/app.ts': app_v3}, 3)
git('tag', '-a', 'v1.0.0', '-m', 'Northstar 1.0.0')

projects_ts = '''
export interface Project {
  id: string;
  name: string;
  archived: boolean;
  updatedAt: string;
}

export function activeProjects(projects: Project[]): Project[] {
  if (!Array.isArray(projects) || projects.length === 0) return [];
  return projects.filter((project) => !project.archived);
}

export function sortByRecent(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
'''

theme_v2 = '''
export interface Theme {
  name: 'dark' | 'light';
  accent: string;
  surface: string;
}

export function createTheme(name: 'dark' | 'light'): Theme {
  return name === 'dark'
    ? { name, accent: '#7e9cff', surface: '#11161d' }
    : { name, accent: '#3f63e0', surface: '#ffffff' };
}
'''

app_v4 = '''
import { createTheme } from './theme';
import { activeProjects, sortByRecent } from './projects';

const theme = createTheme('dark');
const projects = activeProjects([]);
console.log('Northstar ready', theme.accent, sortByRecent(projects).length);
'''

guide_v2 = guide_v1.replace(
    '## Conventions',
    '## Workspace shell\n\nThe shell keeps navigation, status and notifications in separate components.\n\n## Conventions',
)

commit('feat(ui): introduce workspace shell', {
    'src/app.ts': app_v4,
    'src/projects.ts': projects_ts,
    'src/theme.ts': theme_v2,
    'docs/guide.md': guide_v2,
}, 4)

git('checkout', '-b', 'fix/status-parsing')
commit('fix: handle quoted paths in status output', {
    'src/projects.ts': projects_ts + '''
export function normalisePath(input: string): string {
  return input.replace(/\\\\/g, '/').replace(/^"|"$/g, '');
}
''',
}, 5)

git('checkout', 'main')
git('checkout', '-b', 'feature/worktree-gallery')

gallery_ts = '''
export interface GalleryItem {
  branch: string;
  path: string;
  clean: boolean;
}

export function summarise(items: GalleryItem[]): string {
  const dirty = items.filter((item) => !item.clean).length;
  return `${items.length} worktrees, ${dirty} with local changes`;
}
'''

readme_v2 = readme_v1.replace('## Getting started', '## Parallel work\n\nThe worktree gallery shows each checkout and whether it has local changes.\n\n## Getting started')
commit('feat(worktrees): add parallel checkout gallery', {'src/gallery.ts': gallery_ts, 'README.md': readme_v2}, 6)

guide_v3 = guide_v2.replace('## Workspace shell', '## Parallel work\n\nCreate a worktree for each long-running branch. Each worktree has its own index.\n\n## Workspace shell')
commit('docs: explain parallel checkout workflow', {'docs/guide.md': guide_v3}, 7)

git('checkout', 'main')

guide_v4 = guide_v3.replace('## Conventions', '## Tests\n\nRun `npm test` before committing. Add `npm run typecheck` for the strict check.\n\n## Conventions')
commit('chore: prepare 1.1.0 release notes', {
    'CHANGELOG.md': '# Changelog\n\n## 1.1.0\n\n- Introduced the workspace shell.\n- Added project sorting helpers.\n- Documented parallel checkouts.\n',
    'docs/guide.md': guide_v4,
}, 8)
git('tag', '-a', 'v1.1.0', '-m', 'Northstar 1.1.0')

# Create a real stash from a temporary edit.
write('src/theme.ts', theme_v2.replace("  surface: string;\n}", "  surface: string;\n  muted: string;\n}").replace("surface: '#11161d' }", "surface: '#11161d', muted: '#8b9aad' }").replace("surface: '#ffffff' }", "surface: '#ffffff', muted: '#67778b' }"))
git('stash', 'push', '-m', 'WIP: experiment with muted theme tokens')

# A real linked worktree on the feature branch.
git('worktree', 'add', str(WORKTREE), 'feature/worktree-gallery')

# Leave a realistic mix of working-tree changes.
write('src/app.ts', app_v4.replace("import { activeProjects", "import { summarise } from './gallery';\nimport { activeProjects").replace("const projects = activeProjects([]);", "const projects = activeProjects([]);\nconst summary = summarise([{ branch: 'main', path: '.', clean: false }]);").replace("sortByRecent(projects).length);", "sortByRecent(projects).length, summary);"))
write('src/experiments.ts', "// Scratch space for the next iteration.\nexport const idea = 'timeline view for release notes';\n")
write('docs/guide.md', guide_v4 + '\n## Notes\n\nThe next iteration adds a release timeline.\n')
write('src/legacy.ts', 'export const legacyFlag = true;\n')
write('src/gallery.ts', gallery_ts.replace('  clean: boolean;\n}', '  clean: boolean;\n  ahead: number;\n}').replace('const dirty = items.filter((item) => !item.clean).length;', 'const dirty = items.filter((item) => !item.clean).length;\n  const ahead = items.reduce((sum, item) => sum + item.ahead, 0);').replace('${dirty} with local changes`', '${dirty} with local changes, ${ahead} commits ahead`'))
write('src/gallery.test.ts', "import { describe, expect, it } from 'vitest';\nimport { summarise } from './gallery';\n\ndescribe('summarise', () => {\n  it('counts dirty worktrees', () => {\n    expect(summarise([{ branch: 'main', path: '.', clean: false, ahead: 2 }])).toContain('1 with local changes');\n  });\n});\n")

print(ROOT)
print(WORKTREE)
print(git('status', '--short'))
print(git('log', '--oneline', '--all', '--decorate', '-12'))
print(git('stash', 'list'))
print(git('worktree', 'list'))
