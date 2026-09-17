---
name: webgen
description: Generate or edit images through the ChatGPT and Gemini web UIs (your own logged-in browser, subscription quota, no API key) with the bundled genimg.mjs CLI. Use this whenever someone wants an image made, edited, iterated on, upscaled with a reference, or re-downloaded from a chat - "make me an image of", "edit this picture", "generate a visual for", "tweak the last image", "use ChatGPT/Gemini to draw" - even if they never say "webgen". Also use when a run fails with LOGGED OUT, wrong image, or a stuck upload.
---

# webgen - image generation via ChatGPT / Gemini web UIs

`scripts/genimg.mjs` drives a real, headed Chrome with a persistent logged-in profile through Playwright. It types the prompt into the site's composer, waits for a genuinely new image, and downloads it. No API keys; it spends the account's normal subscription quota.

Runtime lives in `scripts/`. Run every command from there:

```bash
cd <this-skill>/scripts
```

## First-time setup (once per machine)

```bash
npm install                                   # playwright-core only
cp accounts.example.json accounts.json        # then edit: your email + profile names
node genimg.mjs login chatgpt-work            # opens Chrome; log in to chatgpt.com AND gemini.google.com, then close the window
```

`accounts.json` maps a profile name to `{site, account, dir}`. One `profiles/<dir>` per email holds cookies for both sites, so log in to both in the same window. Chrome path defaults to the standard Windows install; set `WEBGEN_CHROME` if it lives elsewhere.

`accounts.json`, `profiles/`, `sessions.json`, `usage.json`, `out/` are gitignored: profiles are live logins, never commit or share them.

## Commands

```bash
node genimg.mjs gen  <profile> "<prompt>" [--out f.png] [--attach a.png,b.png]   # new chat, generate
node genimg.mjs iter <profile> "<prompt>" [--out f.png] [--chat url] [--attach ...] # follow-up in the last conversation
node genimg.mjs edit <profile> <img[,img2]> "<prompt>" [--out f.png]              # upload + edit instruction, new chat
node genimg.mjs save <profile> [--chat url] [--out f.png]                        # re-download the newest image
node genimg.mjs list                                                             # profiles, today's usage, login state
node probe.mjs <profile> <url>                                                   # debug: dump the image DOM of a chat
```

`--out` defaults to `out/<timestamp>.png`. The last conversation per profile is remembered in `sessions.json`, so `iter` without `--chat` continues where `gen` left off.

## How to run it well

- **Foreground, generous timeout.** A generation takes 1-3 minutes; the script already waits up to 3 min and retries once. Do not background it and poll.
- **Batch a multi-step flow into one session** (gen, then iter, then iter) rather than opening and closing Chrome per step. Rapid open/close churn looks like a bot.
- **Headed Chrome only.** Headless trips bot detection on both sites.
- **ChatGPT first, Gemini as fallback.** Gemini output carries a visible watermark via its own download button (the canvas grab in this script avoids it; the invisible SynthID remains).
- **"OK" is not a pass.** The CLI has reported success while delivering the wrong image (an uploaded reference instead of the result). Open the PNG and check it before handing it over.
- **Give the user the absolute path** of the saved file.

## When it fails

| Symptom | Cause | Fix |
|---|---|---|
| `LOGGED OUT` error | session expired (Gemini on Workspace accounts dies on every password rotation; ChatGPT survives them) | `node genimg.mjs login <profile>` |
| Timed out, no image | site returned a text refusal or the message never posted | read the chat URL printed in the log; rephrase the prompt |
| Downloaded the reference, not the result | freshness detection picked the upload | `node genimg.mjs save <profile>` after the image visibly lands; if it repeats, see `references/gotchas.md` |
| Enter does nothing | an attachment is still uploading | wait; the script already checks the composer cleared |

For selector / DOM-level problems (the sites change their markup), read `references/gotchas.md` before editing `genimg.mjs`. Every rule there was learned by losing hours to it.

## Terms of service

Automating these web UIs is against both providers' terms. Personal-scale use with human-ish pacing is the operating assumption; an account ban is the risk ceiling. Do not point this at shared or client accounts.
