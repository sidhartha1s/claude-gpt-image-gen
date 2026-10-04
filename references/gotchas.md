# Selector / DOM gotchas (read before touching genimg.mjs)

Each of these cost real hours. They explain why the code is shaped the way it is.

## ChatGPT

- **Results are `blob:` images (since 2026-10-04).** They render under a `generated-image` wrapper with no `<article>`. Freshness works like Gemini: a NEW wrapper containing an image, present across two polls, never a src comparison. The old signed `estuary` URLs (`&sig=` rotating per load) are no longer produced; their selectors stay only for the old DOM, and the `imgKey()` file-id path is gone.
- **Uploads and results share an endpoint.** User-attached images serve from the same `backend-api/estuary` path as generated ones. Generated images are therefore scoped to the `[class*="imagegen-image"]` wrapper; without that scope the freshness check grabs your own upload as the result. Uploads are also `blob:` images but sit outside that wrapper. The composer is a bare ProseMirror div (no `#prompt-textarea`); the selector matches both. A refusal is no longer read as text, so it ends in the generation timeout.
- **Enter is a no-op while an upload is processing.** Attach, wait for the thumbnail to settle, then send. The script verifies the composer is non-empty before Enter and empty after it (message actually posted) before it starts waiting for an image.
- **A retry re-sends the original prompt with its attachments.** On 2026-10-04 ChatGPT dropped posted attachments; a bare "try again" then produced an unrelated image that passed as the result.
- **Never close the context right after send.** Generation aborts or never lands. Wait for a new result wrapper that is present across two consecutive polls.

## Gemini

- **Images are `blob:` URLs.** They rotate on re-render and cannot be fetched from another context. Freshness = a new `model-response` element that contains an image, not a new src. Download by drawing the rendered `<img>` to a canvas in-page and reading `toDataURL()`. This also skips the visible watermark Gemini's own download button stamps on; the invisible SynthID stays.
- **`fill()` silently no-ops on the Quill contenteditable composer.** Always type via `page.keyboard.insertText`, then confirm the composer is non-empty, then confirm it clears after Enter.
- **Sessions on Google Workspace accounts die on every forced password rotation.** `loggedOut()` detects it and the error names the re-login command. ChatGPT sessions survive password changes.

## Both

- **Existing conversations lazy-render.** Baseline image counts taken before the DOM settles are meaningless; wait for stability before snapshotting the baseline, otherwise an old image is reported as new.
- **Headless = bot detection.** Real headed Chrome with a persistent profile passes; keep pacing human-ish and avoid rapid open/close churn.
- **A CLI `OK` is not verification.** The tool has said OK twice while saving the wrong image. Always open the output PNG.
