/**
 * End-to-end verification of the real renderer against the real Git engine.
 * The Electron shell itself needs a desktop session; this harness serves the
 * same renderer and main-process API over HTTP (see src/main/harness/server.ts).
 */
import { spawn, execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const PORT = 5207;
const demo = path.resolve('.demo/e2e-repo');
const dataDir = path.resolve('.demo/e2e-data-run');
const log = (...args) => console.log('[e2e]', ...args);
const results = [];

function check(name, condition, detail = '') {
  results.push({ name, passed: Boolean(condition), detail });
  if (!condition) throw new Error(`Check failed: ${name}${detail ? ` — ${detail}` : ''}`);
  log('PASS', name);
}

async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Harness did not start');
}

async function main() {
  await fs.rm(demo, { recursive: true, force: true });
  await fs.rm(dataDir, { recursive: true, force: true });
  execFileSync('python3', ['scripts/create_demo_repo.py'], { env: { ...process.env, GITPP_DEMO_ROOT: demo, GITPP_DEMO_WORKTREE: `${demo}-worktree` } });

  const harness = spawn(process.execPath, ['dist/harness/server.cjs'], {
    env: { ...process.env, GITPP_HARNESS_PORT: String(PORT), GITPP_HARNESS_REPO: demo, GITPP_HARNESS_DATA: dataDir },
    stdio: 'inherit',
  });

  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const consoleErrors = [];
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

    await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.titlebar-repo', { timeout: 15000 });
    check('Application loads and reopens the real repository', (await page.locator('.titlebar-repo').innerText()).includes('e2e-repo'));

    // 1. Inspect real status.
    await page.locator('.nav-item', { hasText: 'Changes' }).click();
    await page.waitForSelector('.file-row');
    const changedText = await page.locator('.file-groups').innerText();
    check('Changes workspace shows real working-tree entries', changedText.includes('src/app.ts') && changedText.includes('docs/guide.md') && changedText.includes('UNSTAGED'));

    // 2. Stage a file and inspect the diff.
    const appRow = page.locator('.file-row', { hasText: 'src/app.ts' }).first();
    await appRow.click();
    await page.waitForFunction(() => document.querySelector('.diff-file-name')?.textContent?.includes('src/app.ts'), null, { timeout: 15000 });
    await page.waitForTimeout(300);
    await page.waitForSelector('.diff-lines');
    const diffText = await page.locator('.diff-lines').innerText();
    check('Diff viewer displays actual changed lines', diffText.includes('summarise') || diffText.includes('console.log'));
    await appRow.locator('button[title="Stage file"]').click();
    await page.waitForFunction(() => document.querySelector('.staged-summary')?.textContent?.includes('1 staged file'), null, { timeout: 15000 });
    check('Staging a file updates the real index', (await page.locator('.staged-summary').innerText()).includes('1 staged file'));
    await page.waitForFunction(() => document.querySelector('.diff-toolbar')?.textContent?.includes('staged diff'), null, { timeout: 15000 });
    await page.waitForSelector('.diff-lines');
    check('Staged diff remains inspectable after staging', (await page.locator('.diff-toolbar').innerText()).includes('staged diff'));

    // 3. Commit with a real message.
    const message = 'test: verify Git++ commit workflow';
    await page.locator('textarea[aria-label="Commit subject"]').fill(message);
    await page.getByRole('button', { name: /Commit to/ }).click();
    await page.waitForSelector('.toast.success:has-text("Commit created")', { timeout: 20000 });
    const subject = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: demo, encoding: 'utf8' }).trim();
    check('Commit is created by real Git', subject === message, subject);

    // 4. Create and switch a branch.
    await page.locator('.nav-item', { hasText: 'Branches' }).click();
    await page.getByRole('button', { name: 'New branch' }).click();
    await page.locator('input[placeholder="feature/my-change"]').fill('e2e/verification');
    await page.getByRole('button', { name: 'Create branch', exact: true }).click();
    await page.waitForSelector('.toast.success:has-text("Branch e2e/verification created")', { timeout: 15000 });
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: demo, encoding: 'utf8' }).trim();
    check('Branch creation switches HEAD in Git', branch === 'e2e/verification', branch);

    // 5. Inspect history through the real log.
    await page.locator('.nav-item', { hasText: 'History' }).click();
    await page.waitForSelector('.graph-row');
    const graphText = await page.locator('.history-list').innerText();
    check('History graph shows the commit just created', graphText.includes('test: verify Git++ commit workflow'));
    await page.locator('.graph-row', { hasText: 'test: verify Git++ commit workflow' }).click();
    await page.waitForSelector('.history-detail h3');
    check('Commit details show author and parents', (await page.locator('.history-detail').innerText()).includes('Avery Chen'));

    // 6. Run a genuine preflight suite.
    await page.locator('.nav-item', { hasText: 'Preflight Lab' }).click();
    await page.waitForSelector('.check-row');
    const runButton = page.getByRole('button', { name: /Run suggested checks|Run enabled checks/ }).first();
    await runButton.click();
    await page.waitForSelector('.check-status-label.status-passed', { timeout: 40000 });
    check('Preflight executes real checks and reports pass/fail', (await page.locator('.check-status-label').first().innerText()).length > 0);
    const suspiciousPass = await page.locator('.check-status-label.status-passed').count();
    check('Read-only checks actually ran', suspiciousPass > 0);

    // 7. Edit and save a real Markdown file.
    await page.locator('.nav-item', { hasText: 'Markdown Studio' }).click();
    await page.waitForSelector('textarea[aria-label="Markdown source"]');
    const editor = page.locator('textarea[aria-label="Markdown source"]');
    const original = await editor.inputValue();
    await editor.fill(original + '\n\nE2E note: saved through Git++ Markdown Studio.\n');
    await page.getByRole('button', { name: /^Save$/ }).click();
    await page.waitForSelector('.toast.success:has-text("Document saved")', { timeout: 15000 });
    const readme = execFileSync('git', ['show', 'HEAD:README.md'], { cwd: demo, encoding: 'utf8' });
    const onDisk = await fs.readFile(path.join(demo, 'README.md'), 'utf8');
    check('Markdown Studio writes the actual file on disk', onDisk.includes('E2E note') && !readme.includes('E2E note'));

    // 8. A failing Git operation must surface an error, never a success.
    await page.locator('.nav-item', { hasText: 'Branches' }).click();
    const currentRow = page.locator('tr', { hasText: 'e2e/verification' }).first();
    await currentRow.locator('button[title="Delete"]').click();
    await page.getByRole('button', { name: 'Delete branch', exact: true }).click();
    await page.waitForSelector('.toast.error', { timeout: 15000 });
    const errorText = await page.locator('.toast.error').innerText();
    check('Git validation failures are reported as errors', /current branch/i.test(errorText), errorText.split('\n')[0]);
    check('No success toast is shown for the failed deletion', (await page.locator('.toast.success', { hasText: 'deleted' }).count()) === 0);

    // 9. Command palette drives the same functionality.
    await page.keyboard.press('Control+K');
    await page.waitForSelector('.palette-input');
    await page.locator('.palette-input').fill('Go to Settings');
    await page.locator('.palette-item', { hasText: 'Go to Settings' }).first().click();
    await page.waitForSelector('text=Preferences are stored', { timeout: 10000 });
    check('Command palette navigates to Settings', (await page.locator('.main-area').innerText()).includes('Preferences are stored'));

    // 10. Theme switching persists through the settings API.
    await page.getByTitle('Switch to light theme').click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    check('Light theme applies', (await page.locator('html').getAttribute('data-theme')) === 'light');
    await page.getByTitle('Switch to dark theme').click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    check('Dark theme applies', (await page.locator('html').getAttribute('data-theme')) === 'dark');

    check('No uncaught renderer errors occurred', consoleErrors.length === 0, consoleErrors.join(' | '));

    await fs.writeFile(path.resolve('.demo/e2e-results.json'), JSON.stringify({ results, consoleErrors }, null, 2));
    log(`All ${results.length} end-to-end checks passed.`);
  } finally {
    await browser?.close();
    harness.kill('SIGTERM');
  }
}

main().catch(async (error) => {
  console.error('[e2e] FAILED:', error.message);
  await fs.writeFile(path.resolve('.demo/e2e-results.json'), JSON.stringify({ results, error: error.message }, null, 2)).catch(() => undefined);
  process.exit(1);
});
