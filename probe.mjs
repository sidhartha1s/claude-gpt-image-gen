// probe.mjs — open last/given URL in a profile, dump all img elements' src/alt/parent chain. Debug helper.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const [, , profile, url] = process.argv;
const ctx = await chromium.launchPersistentContext(path.join(ROOT, 'profiles', profile), {
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false, viewport: null,
  args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto(url ?? 'https://chatgpt.com/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000);
console.log('URL:', page.url());
const imgs = await page.evaluate(() =>
  [...document.querySelectorAll('img')].map((i) => ({
    src: i.src.slice(0, 140),
    alt: i.alt,
    w: i.naturalWidth, h: i.naturalHeight,
    chain: (() => { let n = i, c = []; for (let k = 0; k < 5 && n.parentElement; k++) { n = n.parentElement; c.push(n.tagName.toLowerCase() + (n.className && typeof n.className === 'string' ? '.' + n.className.split(' ').slice(0, 2).join('.') : '')); } return c.join(' < '); })(),
  }))
);
console.log(JSON.stringify(imgs, null, 1));
await ctx.close();
