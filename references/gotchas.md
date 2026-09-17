# Selector / DOM gotchas (read before touching genimg.mjs)

Each of these cost real hours. They explain why the code is shaped the way it is.

## ChatGPT

- **Image URLs are signed.** `&sig=` rotates on every page load, so two loads of the same image have different `src`. Image identity is the `id=file_xxx` query param (`imgKey()`), never the full URL. Comparing full URLs makes every image look "new".
- **Uploads and results share an endpoint.** User-attached images serve from the same `backend-api/estuary` path as generated ones. Generated images are therefore scoped to the `[class*="imagegen-image"]` wrapper; without that scope the freshness check grabs your own upload as the result.
- **Enter is a no-op while an upload is processing.** Attach, wait for the thumbnail to settle, then send. The script verifies the composer is non-empty before Enter and empty after it (message actually posted) before it starts waiting for an image.
- **Never close the context right after send.** Generation aborts or never lands. Wait for a new `file_` id that is stable across two consecutive polls.

## Gemini

- **Images are `blob:` URLs.** They rotate on re-render and cannot be fetched from another context. Freshness = a new `model-response` element that contains an image (`unstableSrc: true`), not a new src. Download by drawing the rendered `<img>` to a canvas in-page and reading `toDataURL()`. This also skips the visible watermark Gemini's own download button stamps on; the invisible SynthID stays.
- **`fill()` silently no-ops on the Quill contenteditable composer.** Always type via `page.keyboard.insertText`, then confirm the composer is non-empty, then confirm it clears after Enter.
- **Sessions on Google Workspace accounts die on every forced password rotation.** `loggedOut()` detects it and the error names the re-login command. ChatGPT sessions survive password changes.

## Both

- **Existing conversations lazy-render.** Baseline image counts taken before the DOM settles are meaningless; wait for stability before snapshotting the baseline, otherwise an old image is reported as new.
- **Headless = bot detection.** Real headed Chrome with a persistent profile passes; keep pacing human-ish and avoid rapid open/close churn.
- **A CLI `OK` is not verification.** The tool has said OK twice while saving the wrong image. Always open the output PNG.
