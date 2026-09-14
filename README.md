# webgen

Playwright CLI that generates images through the ChatGPT and Gemini web UIs (subscription quota, not their APIs), driven by persistent logged-in Chrome profiles.

## What it does
- Drives real, headed Chrome with a saved login profile per account. One Chrome profile directory per email is shared between chatgpt.com and gemini.google.com.
- Generates images, follows up in the last conversation, uploads and edits existing images, and re-downloads the newest image from a chat.
- Tracks profile-to-site mapping (`accounts.json`), last conversation per profile (`sessions.json`), and per-day usage (`usage.json`).

## Quick start
```
npm install                                # playwright-core only
node genimg.mjs login chatgpt-simplotel    # opens Chrome, log in, close the window
```
Log into both chatgpt.com and gemini.google.com in the same login window; both sites share one profile per email.

## Commands
```
node genimg.mjs gen  <profile> "<prompt>" [--out f] [--attach a.png,b.png]
node genimg.mjs iter <profile> "<prompt>" [--out f] [--chat url] [--attach ...]   # follow-up in the last conversation
node genimg.mjs edit <profile> <img[,img2]> "<prompt>" [--out f]                  # upload + edit, new chat
node genimg.mjs save <profile> [--chat url] [--out f]                             # re-download the newest image
node genimg.mjs list                                                              # profiles, usage, login state
node probe.mjs <profile> <url>                                                    # debug: dump the image DOM
```
Known profiles: `chatgpt-simplotel`, `chatgpt-sid`, `gemini-simplotel`, `gemini-sid`.

## Layout
| Path | Role |
|---|---|
| `genimg.mjs` | Main CLI (login, gen, iter, edit, save, list) |
| `probe.mjs` | DOM debug helper for a given profile/URL |
| `accounts.json` | Profile directory to site mapping |
| `sessions.json`, `usage.json` | Runtime state (last conversation, per-day usage) |

## Notes / gotchas
- Headed real Chrome only; headless trips bot detection. Use human-ish pacing and avoid rapid open/close churn.
- ChatGPT is primary, Gemini is fallback by owner policy. ChatGPT sessions survive password changes; Gemini on the Workspace account is logged out by every 14-day password rotation, and a run then fails loud with a `LOGGED OUT` error naming the re-login command.
- Generations take 1 to 3 minutes; run commands in the foreground with a generous timeout.
- A CLI `OK` is not a pass. Eyeball the output PNG.
- Selector gotchas worth knowing before touching the scraping code: ChatGPT image URLs are signed and rotate per page load, so image identity is the `id=file_xxx` param, never the full URL. Generated images are scoped to the `[class*="imagegen-image"]` wrapper to avoid matching user uploads. Gemini serves images as rotating `blob:` URLs, so freshness is detected as a new `model-response` node and the image is grabbed via an in-page canvas draw, which also strips the visible watermark (invisible SynthID remains). Playwright's `fill()` silently no-ops on Gemini's rich-text composer, so text goes in via `keyboard.insertText`, then the composer is checked non-empty, then checked cleared after Enter, before waiting for the image.

## ToS note
Automating these web UIs is against both providers' terms of service. Personal-scale use with human-ish pacing is the operating assumption, and an account ban is the risk ceiling.
