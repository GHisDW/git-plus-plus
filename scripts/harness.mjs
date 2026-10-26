import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32', ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!existsSync('dist/renderer/index.html')) run('npx', ['vite', 'build']);
if (!existsSync('dist/harness/server.cjs') || !existsSync('dist/main/electron.js')) run('node', ['scripts/build-main.mjs']);

const child = spawn(process.execPath, ['dist/harness/server.cjs'], { stdio: 'inherit', env: process.env });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
child.on('exit', (code) => process.exit(code ?? 0));
