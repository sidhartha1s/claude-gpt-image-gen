# webgen

Image generation via **ChatGPT / Gemini web UIs** (subscription quota, not API) using persistent logged-in Chrome profiles driven by Playwright.

## Setup

```bash
npm install                      # playwright-core only
node genimg.mjs login chatgpt-simplotel   # opens Chrome; log in, close window
```

One Chrome profile dir per email (`profiles/simplotel`, `profiles/sid`) holds cookies for BOTH sites — log into chatgpt.com and gemini.google.com in the same login window. Profile↔site mapping lives in `accounts.json` (`dir` field).

## Commands

```bash
node genimg.mjs gen  <profile> "<prompt>" [--out f] [--attach a.png,b.png]
node genimg.mjs iter <profile> "<prompt>" [--out f] [--chat url] [--attach ...]   # follow-up in last conversation
node genimg.mjs edit <profile> <img[,img2]> "<prompt>" [--out f]                  # upload + edit, new chat
node genimg.mjs save <profile> [--chat url] [--out f]                             # re-download newest image
node genimg.mjs list                                                              # profiles, usage, login state
node probe.mjs <profile> <url>                                                    # debug: dump img DOM
```

Profiles: `chatgpt-simplotel`, `chatgpt-sid`, `gemini-simplotel`, `gemini-sid`. Last conversation per profile is remembered in `sessions.json`; per-day usage counts in `usage.json`.

## Operating notes

- **Headed real Chrome only** — headless trips bot detection. Human-ish pacing; avoid rapid open/close churn.
- ChatGPT primary, Gemini fallback (owner policy). ChatGPT sessions survive password changes; **Gemini on the Workspace account dies on every 14-day password rotation** — runs then fail loud with a `LOGGED OUT` error naming the re-login command.
- Gens run 1–3 min; run commands in the foreground with a generous timeout.
- **A CLI `OK` is not a pass — eyeball the output PNG.**

## Hard-won selector/DOM gotchas

- ChatGPT image URLs are signed (`&sig=` rotates per page load) → image identity = `id=file_xxx`, never the full URL.
- User-uploaded attachments serve from the same `backend-api/estuary` endpoint as generated images → generated images are scoped to the `[class*="imagegen-image"]` wrapper.
- Gemini serves images as `blob:` URLs (rotate on re-render, unfetchable cross-context) → freshness = a new `model-response` containing an image; download via in-page canvas draw. Canvas grab avoids Gemini's visible download watermark (invisible SynthID remains).
- Playwright `fill()` silently no-ops on Quill/rich contenteditables (Gemini) → always type via `keyboard.insertText`, then verify the composer is non-empty, then verify it CLEARS after Enter (message actually posted) before waiting for the image.
- Existing conversations lazy-render → wait for DOM stability before taking the freshness baseline.

## ToS note

Automating these web UIs is against both providers' terms; personal-scale use with human-ish pacing is the operating assumption. Account bans are the risk ceiling.
