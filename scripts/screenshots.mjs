/** Capture real UI screenshots from the Git++ renderer backed by the real Git engine. */
import { spawn, execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const PORT = 5206;
const repo = path.resolve('.demo/screenshot-repo');
const worktree = path.resolve('.demo/screenshot-worktree');
const dataDir = path.resolve('.demo/screenshot-data');
const outDir = path.resolve('docs/screenshots');

const waitForServer = async () => {
  for (let i = 0; i < 100; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (response.ok) return;
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('harness did not start');
};

async function main() {
  await fs.rm(repo, { recursive: true, force: true });
  await fs.rm(worktree, { recursive: true, force: true });
  await fs.rm(dataDir, { recursive: true, force: true });
  execFileSync('python3', ['scripts/create_demo_repo.py'], { env: { ...process.env, GITPP_DEMO_ROOT: repo, GITPP_DEMO_WORKTREE: worktree } });
  await fs.mkdir(outDir, { recursive: true });

  const harness = spawn(process.execPath, ['dist/harness/server.cjs'], {
    env: { ...process.env, GITPP_HARNESS_PORT: String(PORT), GITPP_HARNESS_REPO: repo, GITPP_HARNESS_DATA: dataDir },
    stdio: 'inherit',
  });

  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const shot = async (name) => {
      await page.waitForTimeout(450);
      await page.screenshot({ path: path.join(outDir, name) });
      console.log('[screenshots]', name);
    };
    const nav = async (label) => {
      await page.locator('.nav-item', { hasText: label }).first().click();
      await page.waitForTimeout(700);
    };

    await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.titlebar-repo');
    await shot('01-home-dark.png');

    await nav('Changes');
    const appRow = page.locator('.file-row', { hasText: 'src/app.ts' }).first();
    await appRow.click();
    await page.waitForFunction(() => document.querySelector('.diff-file-name')?.textContent?.includes('src/app.ts'));
    await page.waitForSelector('.diff-lines');
    await shot('02-changes-diff.png');

    await nav('History');
    await page.waitForSelector('.graph-row');
    await shot('03-history-graph.png');

    await nav('Branches');
    await page.waitForSelector('.table');
    await shot('04-branches.png');

    await nav('Parallel Universes');
    await page.waitForSelector('.worktree-card');
    await shot('05-parallel-universes.png');

    await nav('Preflight Lab');
    await page.waitForSelector('.check-row');
    const run = page.getByRole('button', { name: /Run suggested checks|Run enabled checks/ }).first();
    await run.click();
    await page.waitForSelector('.check-status-label.status-passed', { timeout: 40000 });
    await page.waitForTimeout(600);
    await shot('06-preflight-lab.png');

    await nav('Markdown Studio');
    await page.waitForSelector('textarea[aria-label="Markdown source"]');
    await shot('07-markdown-studio.png');

    await nav('Settings');
    await shot('08-settings.png');

    await nav('GitHub');
    await page.waitForTimeout(600);
    await shot('09-github-setup.png');

    // Light theme from the real theme control.
    await page.getByTitle('Switch to light theme').click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await nav('Home');
    await shot('10-home-light.png');
    await nav('Changes');
    await page.waitForSelector('.diff-lines');
    await shot('11-changes-light.png');

    await page.getByTitle('Switch to dark theme').click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await page.keyboard.press('Control+K');
    await page.waitForSelector('.palette-input');
    await shot('12-command-palette.png');

    const manifest = await fs.readdir(outDir);
    console.log('[screenshots] files:', manifest.join(', '));
  } finally {
    await browser?.close();
    harness.kill('SIGTERM');
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('[screenshots] failed:', error);
  process.exit(1);
});
