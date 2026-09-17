# webgen skill (repo: claude-gpt-image-gen)

Generate and edit images through the ChatGPT / Gemini **web UIs** using your own logged-in browser. No API keys, no per-image cost; it spends the account's subscription quota.

## Install

Share the packaged `webgen.skill` archive (or a copy of the working tree without `.git`), never a clone of this repo. Unzip / copy it to `~/.claude/skills/webgen/` (Claude Code picks it up on next start), then:

```bash
cd ~/.claude/skills/webgen/scripts
npm install
cp accounts.example.json accounts.json   # put your own email(s) in
node genimg.mjs login chatgpt-work       # log in to chatgpt.com and gemini.google.com in the window that opens, then close it
```

Requires Node 18+ and Google Chrome at the default Windows path (override with `WEBGEN_CHROME=<path to chrome.exe>`).

## Use

Ask Claude for an image ("make me a hero image of ...", "edit this photo to ...", "iterate on the last one, warmer light"). The skill runs the CLI for you. Or call it directly:

```bash
node genimg.mjs gen  chatgpt-work "isometric illustration of a hotel lobby, soft daylight" --out lobby.png
node genimg.mjs iter chatgpt-work "same scene, add a bellhop at the desk"
node genimg.mjs edit chatgpt-work photo.png "remove the people, keep the lighting"
node genimg.mjs list
```

Full command list and failure table: `SKILL.md`. DOM gotchas for maintainers: `references/gotchas.md`.

## What never leaves your machine

`accounts.json`, `profiles/` (browser cookies = live logins), `sessions.json`, `usage.json`, `out/`. All gitignored. Do not share a `profiles/` folder with anyone.

## Terms

Automating these web UIs is against both providers' terms of service. Use your own account, at human pace, and accept that a ban is the worst case.
