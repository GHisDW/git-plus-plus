import { chromium } from 'playwright';
import { promises as fs } from 'node:fs';
const svg = await fs.readFile('build/icon.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
await page.screenshot({ path: 'build/icon.png', omitBackground: true });
await browser.close();
