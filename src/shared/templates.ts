import type { IgnoreTemplate, PreflightCheckConfig } from './types';

export const IGNORE_TEMPLATES: IgnoreTemplate[] = [
  {
    id: 'node',
    name: 'Node.js',
    description: 'Dependencies, build output and local environment files for JavaScript projects.',
    lines: ['node_modules/', 'dist/', 'build/', '.env', '.env.local', '*.log', 'npm-debug.log*', 'pnpm-debug.log*', 'coverage/', '.cache/'],
  },
  {
    id: 'typescript',
    name: 'TypeScript',
    description: 'Compiled output and incremental build metadata.',
    lines: ['*.tsbuildinfo', 'out/', '.tsbuildinfo'],
  },
  {
    id: 'python',
    name: 'Python',
    description: 'Virtual environments, bytecode and test caches.',
    lines: ['__pycache__/', '*.py[cod]', '.venv/', 'venv/', '.pytest_cache/', '.mypy_cache/', '.ruff_cache/', '*.egg-info/'],
  },
  {
    id: 'rust',
    name: 'Rust',
    description: 'Cargo build artifacts.',
    lines: ['target/', '**/*.rs.bk', 'Cargo.lock.bak'],
  },
  {
    id: 'go',
    name: 'Go',
    description: 'Compiled binaries and test output.',
    lines: ['*.exe', '*.exe~', '*.dll', '*.so', '*.dylib', '*.test', '*.out', 'vendor/'],
  },
  {
    id: 'java',
    name: 'Java / Kotlin',
    description: 'Build directories and IDE metadata.',
    lines: ['*.class', 'build/', 'target/', '.gradle/', '*.jar', '*.war', '.idea/', '*.iml'],
  },
  {
    id: 'dotnet',
    name: '.NET',
    description: 'Visual Studio build output and user files.',
    lines: ['bin/', 'obj/', '*.user', '*.suo', 'packages/', '.vs/'],
  },
  {
    id: 'os',
    name: 'Operating system',
    description: 'Thumbnails and metadata created by Windows, macOS and Linux.',
    lines: ['Thumbs.db', 'ehthumbs.db', 'Desktop.ini', '.DS_Store', '.Spotlight-V100', '.Trashes', '*~'],
  },
  {
    id: 'editors',
    name: 'Editors & IDEs',
    description: 'Local editor settings that should not be shared.',
    lines: ['.vscode/settings.json', '.vscode/launch.json', '.idea/', '*.swp', '*.swo', '.project', '.classpath'],
  },
  {
    id: 'secrets',
    name: 'Secrets & credentials',
    description: 'Common local credential files. Ignoring does not remove tracked files.',
    lines: ['.env', '.env.*', '!.env.example', '*.pem', '*.key', '!*.pub', 'secrets/', '.aws/credentials'],
  },
  {
    id: 'electron',
    name: 'Electron',
    description: 'Packaged application output.',
    lines: ['dist/', 'out/', 'release/', '*.asar', '.electron-builder-cache/'],
  },
  {
    id: 'terraform',
    name: 'Terraform',
    description: 'State files and local provider caches.',
    lines: ['*.tfstate', '*.tfstate.*', '.terraform/', 'crash.log', '*.tfvars', '!*.tfvars.example'],
  },
];

/** Suggested checks that only use tools already present in the repository. */
export function suggestChecks(repoPath: string, manifests: { hasPackageJson: boolean; packageManager: string | null; hasPyproject: boolean; hasCargo: boolean; hasGo: boolean }): PreflightCheckConfig[] {
  const checks: PreflightCheckConfig[] = [
    {
      id: 'status',
      name: 'Working tree review',
      type: 'status',
      command: null,
      args: [],
      required: true,
      timeoutMs: 15_000,
      enabled: true,
      description: 'Reports staged, unstaged and untracked files so nothing is committed by accident.',
    },
    {
      id: 'conflicts',
      name: 'Merge conflict check',
      type: 'conflicts',
      command: null,
      args: [],
      required: true,
      timeoutMs: 15_000,
      enabled: true,
      description: 'Fails if unresolved conflict markers are present in the index.',
    },
    {
      id: 'secrets',
      name: 'Diff whitespace & conflict marker scan',
      type: 'secret-scan',
      command: null,
      args: [],
      required: false,
      timeoutMs: 30_000,
      enabled: true,
      description: 'Uses `git diff --check` to detect whitespace errors and leftover conflict markers in staged changes.',
    },
  ];
  if (manifests.hasPackageJson) {
    const pm = manifests.packageManager ?? 'npm';
    checks.push(
      {
        id: 'typecheck',
        name: 'Type check',
        type: 'command',
        command: pm,
        args: ['run', 'typecheck'],
        required: false,
        timeoutMs: 180_000,
        enabled: false,
        description: `Runs ${pm} run typecheck. Enable only if this script exists and you trust the repository.`,
      },
      {
        id: 'tests',
        name: 'Unit tests',
        type: 'command',
        command: pm,
        args: pm === 'npm' ? ['test'] : ['test'],
        required: false,
        timeoutMs: 300_000,
        enabled: false,
        description: `Runs ${pm} test. Repository scripts execute code on your machine.`,
      },
      {
        id: 'build',
        name: 'Build',
        type: 'command',
        command: pm,
        args: ['run', 'build'],
        required: false,
        timeoutMs: 300_000,
        enabled: false,
        description: `Runs ${pm} run build.`,
      },
    );
  }
  if (manifests.hasPyproject) {
    checks.push({
      id: 'pytest',
      name: 'pytest',
      type: 'command',
      command: 'python',
      args: ['-m', 'pytest'],
      required: false,
      timeoutMs: 300_000,
      enabled: false,
      description: 'Runs the Python test suite via `python -m pytest`.',
    });
  }
  if (manifests.hasCargo) {
    checks.push({
      id: 'cargo-test',
      name: 'cargo test',
      type: 'command',
      command: 'cargo',
      args: ['test'],
      required: false,
      timeoutMs: 300_000,
      enabled: false,
      description: 'Runs the Rust test suite.',
    });
  }
  if (manifests.hasGo) {
    checks.push({
      id: 'go-test',
      name: 'go test',
      type: 'command',
      command: 'go',
      args: ['test', './...'],
      required: false,
      timeoutMs: 300_000,
      enabled: false,
      description: 'Runs Go tests for all packages.',
    });
  }
  void repoPath;
  return checks;
}
