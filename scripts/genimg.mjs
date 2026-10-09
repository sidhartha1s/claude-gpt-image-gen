#!/usr/bin/env node
// genimg — image generation via ChatGPT / Gemini web UIs using persistent logged-in Chrome profiles.
// Usage:
//   node genimg.mjs login <profile>                          one-time manual login
//   node genimg.mjs gen  <profile> "<prompt>" [--out f]      new chat, generate image
//   node genimg.mjs iter <profile> "<prompt>" [--out f] [--chat url]
//                                                            follow-up in last (or given) conversation
//   node genimg.mjs edit <profile> <img[,img2]> "<prompt>" [--out f]
//                                                            upload image(s) + edit instruction (new chat)
//   node genimg.mjs save <profile> [--chat url] [--out f]    download newest image from last/given conversation
//   gen/iter also take --attach a.png[,b.png]                attach reference image(s) with the prompt
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const USAGE_FILE = path.join(ROOT, 'usage.json');
const SESSIONS_FILE = path.join(ROOT, 'sessions.json');
const DEFAULT_CHROME = {
  win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
}[process.platform] ?? '/usr/bin/google-chrome';
const CHROME = process.env.WEBGEN_CHROME ?? DEFAULT_CHROME;
const CDP_BASE_PORT = 9340; // one debug port per profile dir, in accounts.json order
const GEN_TIMEOUT_MS = 180_000;
const SEND_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 1;

const readJson = (f, d = {}) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 2));
const ACCOUNTS = readJson(path.join(ROOT, 'accounts.json'), null);
if (!ACCOUNTS) { console.error('FAIL: accounts.json missing/unreadable'); process.exit(1); }

function bumpUsage(profile) {
  const u = readJson(USAGE_FILE);
  const day = new Date().toISOString().slice(0, 10);
  u[profile] ??= {};
  u[profile][day] = (u[profile][day] ?? 0) + 1;
  writeJson(USAGE_FILE, u);
  return u[profile][day];
}
function rememberChat(profile, url) {
  const s = readJson(SESSIONS_FILE);
  s[profile] = { chat: url, at: new Date().toISOString() };
  writeJson(SESSIONS_FILE, s);
}
function parseFileList(raw) {
  const files = raw.split(',').map((f) => path.resolve(f.trim()));
  for (const f of files) if (!fs.existsSync(f)) throw new Error(`No such file: ${f}`);
  return files;
}

// One long-lived Chrome per profile dir. A call attaches to it when it is already running, starts it once when it is
// not, works in its own tab, and closes only that tab: the browser is never closed from here. Opening and closing a
// window per call looks like a bot to the site and to the person at the screen, so no caller can do it.
async function withPage(profile, fn) {
  if (!ACCOUNTS[profile]) throw new Error(`Unknown profile "${profile}". Known: ${Object.keys(ACCOUNTS).join(', ')}`);
  const dirOf = (name) => ACCOUNTS[name].dir ?? name;
  const dir = path.join(ROOT, 'profiles', dirOf(profile));
  fs.mkdirSync(dir, { recursive: true });
  const port = CDP_BASE_PORT + [...new Set(Object.keys(ACCOUNTS).map(dirOf))].indexOf(dirOf(profile));
  const attach = () => chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 3000 }).catch(() => null);
  let browser = await attach();
  if (!browser) {
    spawn(CHROME, [`--user-data-dir=${dir}`, `--remote-debugging-port=${port}`, '--disable-blink-features=AutomationControlled',
      '--no-first-run', '--no-default-browser-check'], { detached: true, stdio: 'ignore' }).unref();
    for (let i = 0; i < 20 && !browser; i++) { await new Promise((r) => setTimeout(r, 1000)); browser = await attach(); }
    if (!browser) throw new Error(`Chrome for profile dir "${dirOf(profile)}" did not answer on port ${port}`);
  }
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  try {
    return await fn(page, ctx);
  } finally {
    await page.close().catch(() => {});
    await browser.close(); // attached over CDP: this drops our connection, Chrome keeps running
  }
}

const ERROR_PHRASES = ["wasn't able to", 'unable to', "can't create", 'error on my side', 'something went wrong'];

const SITES = {
  chatgpt: {
    url: 'https://chatgpt.com/',
    loggedOut: (page) => /auth\.openai\.com|\/auth|log-?in/i.test(page.url()),
    // imagegen-image wrapper marks GENERATED images; user-uploaded attachments also serve from
    // backend-api/estuary and must not count (they lack this wrapper)
    // 2026-10-04: results render as blob: <img> under a generated-image wrapper and <article> is gone;
    // each wrapper counts as one response (refusal text no longer detected: a refusal ends in the timeout)
    imgSel: '[class*="generated-image"] img, [class*="imagegen-image"] img[src*="backend-api/estuary/content"], [class*="imagegen-image"] img[src*="oaiusercontent"]',
    respSel: '[class*="generated-image"], [class*="imagegen-image"]',
    // composer moved from #prompt-textarea to a bare ProseMirror div (seen 2026-10-04); match both
    boxSel: '#prompt-textarea, div.ProseMirror[contenteditable="true"]',
    box: (page) => page.locator('#prompt-textarea, div.ProseMirror[contenteditable="true"]').first(),
    sendReady: (page) => page.locator('button[data-testid="send-button"]:not([disabled]):not([aria-disabled="true"])'),
    chatUrl: (page) => /\/c\//.test(page.url()) ? page.url() : null,
  },
  gemini: {
    url: 'https://gemini.google.com/app',
    loggedOut: (page) => /accounts\.google\.com/i.test(page.url()),
    imgSel: 'model-response img[src*="googleusercontent"], generated-image img',
    respSel: 'model-response',
    boxSel: 'rich-textarea .ql-editor',
    box: (page) => page.locator('rich-textarea .ql-editor, div[contenteditable="true"]').first(),
    sendReady: (page) => page.locator('button[aria-label*="Send"]:not([aria-disabled="true"])'),
    chatUrl: (page) => /\/app\/\w/.test(page.url()) ? page.url() : null,
  },
};

// One DOM round-trip per poll tick: image srcs, responses-containing-images, error-text count.
async function snapshot(page, site) {
  return page.evaluate(({ imgSel, respSel, phrases }) => {
    const srcs = [...document.querySelectorAll(imgSel)].map((i) => i.src).filter(Boolean);
    const resps = [...document.querySelectorAll(respSel)];
    const withImg = resps.filter((r) => r.querySelector(imgSel));
    const errCount = resps
      .filter((a) => { const t = a.innerText?.toLowerCase() ?? ''; return phrases.some((p) => t.includes(p)); }).length;
    return { srcs, errCount, imgResponses: withImg.length, lastRespImg: withImg.at(-1)?.querySelector(imgSel)?.src ?? null };
  }, { imgSel: site.imgSel, respSel: site.respSel, phrases: ERROR_PHRASES });
}

// Attach (waiting for upload to make the send button ready), fill, send —
// then VERIFY the message actually posted (composer cleared) before returning.
async function sendMessage(page, site, text, attachFiles) {
  const box = site.box(page);
  await box.waitFor({ timeout: 30_000 });
  if (attachFiles?.length) {
    await page.locator('input[type="file"]').first().setInputFiles(attachFiles);
  }
  await box.click();
  // never fill(): on Quill (Gemini) it paints the DOM without updating the editor model,
  // so Enter sends nothing and the composer "clears" — type through the keyboard instead
  await page.keyboard.insertText(text);
  if (!(await box.innerText()).trim()) throw new Error('Could not enter prompt into composer.');
  if (attachFiles?.length) {
    // upload must finish before send is possible; button readiness is the real signal
    await site.sendReady(page).waitFor({ timeout: SEND_TIMEOUT_MS }).catch(() => {});
  }
  const deadline = Date.now() + SEND_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await page.keyboard.press('Enter');
    try {
      await page.waitForFunction(
        (sel) => !(document.querySelector(sel)?.innerText ?? '').trim(),
        site.boxSel,
        { timeout: 5000 },
      );
      return; // composer cleared -> message posted
    } catch {
      // not sent yet (upload processing, or Enter ignored) — try the send button, then loop
      await site.sendReady(page).click({ timeout: 2000 }).catch(() => {});
    }
  }
  throw new Error('Message did not send within 60s (composer never cleared).');
}

// Waits for a NEW response containing an image (vs baseline) or a generation-error message.
// Returns after the fresh src is stable across two consecutive reads.
async function waitForResult(page, site, base) {
  const deadline = Date.now() + GEN_TIMEOUT_MS;
  let seenFresh = false;
  while (Date.now() < deadline) {
    const snap = await snapshot(page, site);
    // both sites serve blob: srcs that rotate on re-render: fresh = a NEW response containing an image
    const freshSrc = snap.imgResponses > base.imgResponses ? snap.lastRespImg : null;
    if (freshSrc) {
      if (seenFresh) return { src: freshSrc }; // present across two ticks
      seenFresh = true;
    } else if (snap.errCount > base.errCount) {
      return { error: 'site reported a generation error' };
    }
    await page.waitForTimeout(2000);
  }
  return { error: `timeout after ${GEN_TIMEOUT_MS / 1000}s — no image appeared` };
}

async function saveImage(ctx, page, site, src, outFile) {
  if (src.startsWith('blob:') || src.startsWith('data:')) {
    // blob: URLs can't be fetched cross-context — draw the rendered <img> to a canvas instead.
    // Blob URLs also rotate between detection and save, so fall back to the newest generated image.
    const b64 = await page.evaluate(({ s, imgSel }) => {
      const img = [...document.querySelectorAll('img')].find((i) => i.src === s)
        ?? [...document.querySelectorAll(imgSel)].filter((i) => i.naturalWidth).at(-1);
      if (!img || !img.naturalWidth) throw new Error('image node not found or not loaded');
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/png').split(',')[1];
    }, { s: src, imgSel: site.imgSel });
    fs.writeFileSync(outFile, Buffer.from(b64, 'base64'));
  } else {
    const resp = await ctx.request.get(src);
    if (!resp.ok()) throw new Error(`Image download failed: HTTP ${resp.status()}`);
    fs.writeFileSync(outFile, await resp.body());
  }
}

// One generate-or-edit operation on an already-open page. A retry re-sends the original prompt
// WITH its attachments: ChatGPT can drop posted attachments (2026-10-04), and a bare "try again"
// then invents an unrelated image that the freshness check accepts as the result.
async function generateOnPage(page, ctx, profile, { text, chatUrl = null, attachFiles = null, outFile }) {
  const site = SITES[ACCOUNTS[profile].site];
  await page.goto(chatUrl ?? site.url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000); // allow auth redirect to surface
  if (site.loggedOut(page)) throw new Error(`profile ${profile} is LOGGED OUT (likely password change). Fix: node genimg.mjs login ${profile}`);
  if (chatUrl) {
    // existing conversations lazy-render; baseline counts are meaningless until the DOM is stable
    let prev = null;
    for (let i = 0; i < 10; i++) {
      const s = await snapshot(page, site);
      const sig = `${s.imgResponses}:${s.srcs.length}`;
      if (sig === prev && s.imgResponses > 0) break;
      prev = sig;
      await page.waitForTimeout(2000);
    }
  }

  let attempt = 0;
  while (true) {
    const base = await snapshot(page, site);
    await sendMessage(page, site, text, attachFiles);
    const res = await waitForResult(page, site, base);
    if (res.src) {
      await saveImage(ctx, page, site, res.src, outFile);
      const convo = site.chatUrl(page);
      if (convo) rememberChat(profile, convo);
      const n = bumpUsage(profile);
      console.log(`OK ${outFile} (today on ${profile}: ${n})${convo ? `\nchat: ${convo}` : ''}`);
      return;
    }
    if (attempt++ >= MAX_RETRIES) throw new Error(`Generation failed after ${attempt} attempt(s): ${res.error}`);
    console.error(`[retry] ${res.error}`);
  }
}

const run = (profile, opts) => withPage(profile, (page, ctx) => generateOnPage(page, ctx, profile, opts));

const [, , cmd, profile, ...rest] = process.argv;
const FLAGS = ['--out', '--chat', '--attach'];
const flag = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : null; };
const positionals = rest.filter((a, i) => !a.startsWith('--') && !FLAGS.includes(rest[i - 1]));
const outFileFor = (p) => {
  const f = flag('--out') ?? path.join(ROOT, 'out', `${p}-${Date.now()}.png`);
  fs.mkdirSync(path.dirname(path.resolve(f)), { recursive: true });
  return f;
};
const attachList = () => { const raw = flag('--attach'); return raw ? parseFileList(raw) : null; };
const lastChatFor = (p) => flag('--chat') ?? readJson(SESSIONS_FILE)[p]?.chat;

try {
  if (cmd === 'list') {
    const u = readJson(USAGE_FILE), s = readJson(SESSIONS_FILE);
    const day = new Date().toISOString().slice(0, 10);
    for (const [name, a] of Object.entries(ACCOUNTS)) {
      const logged = fs.existsSync(path.join(ROOT, 'profiles', a.dir ?? name, 'Default'));
      console.log(`${name.padEnd(20)} ${a.site.padEnd(8)} ${a.account.padEnd(28)} login:${logged ? 'yes' : 'NO '} today:${u[name]?.[day] ?? 0}${s[name] ? '  last-chat:yes' : ''}`);
    }
  } else if (cmd === 'login') {
    await withPage(profile, async (page, ctx) => {
      await page.goto(SITES[ACCOUNTS[profile].site].url);
      console.log(`Log in as ${ACCOUNTS[profile].account}, then close the browser window.`);
      await new Promise((res) => ctx.on('close', res));
      console.log('Profile saved.');
    }).catch((e) => { if (!/closed/i.test(e.message)) throw e; }); // user closing the window is success
  } else if (cmd === 'gen') {
    if (!positionals[0]) throw new Error('Missing prompt.');
    await run(profile, { text: `Create an image: ${positionals[0]}`, attachFiles: attachList(), outFile: outFileFor(profile) });
  } else if (cmd === 'iter') {
    if (!positionals[0]) throw new Error('Missing prompt.');
    const chat = lastChatFor(profile);
    if (!chat) throw new Error(`No previous conversation for ${profile}. Run gen first or pass --chat <url>.`);
    await run(profile, { text: positionals[0], chatUrl: chat, attachFiles: attachList(), outFile: outFileFor(profile) });
  } else if (cmd === 'edit') {
    const [imageFiles, prompt] = positionals;
    if (!imageFiles || !prompt) throw new Error('Usage: edit <profile> <image-file(s)> "<prompt>" (comma-separate multiple files)');
    await run(profile, { text: `Edit this image: ${prompt}`, attachFiles: parseFileList(imageFiles), outFile: outFileFor(profile) });
  } else if (cmd === 'save') {
    const chat = lastChatFor(profile);
    if (!chat) throw new Error(`No conversation known for ${profile}. Pass --chat <url>.`);
    await withPage(profile, async (page, ctx) => {
      const site = SITES[ACCOUNTS[profile].site];
      await page.goto(chat, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
      if (site.loggedOut(page)) throw new Error(`profile ${profile} is LOGGED OUT (likely password change). Fix: node genimg.mjs login ${profile}`);
      await page.waitForSelector(site.imgSel, { timeout: 30_000 });
      const { srcs } = await snapshot(page, site);
      if (!srcs.length) throw new Error('No generated images found in that conversation.');
      const outFile = outFileFor(profile);
      await saveImage(ctx, page, site, srcs.at(-1), outFile);
      rememberChat(profile, chat);
      console.log(`OK ${outFile}`);
    });
  } else {
    console.log('Usage: genimg.mjs login|gen|iter|edit|save|list  (see file header)');
    process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error(`FAIL: ${e.message}`);
  process.exit(1);
}
