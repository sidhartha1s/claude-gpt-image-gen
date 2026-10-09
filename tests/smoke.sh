#!/usr/bin/env bash
# Smoke tests: no browser, no login. Runs in a temp copy so real accounts/sessions/usage are never touched.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cp "$root"/scripts/*.mjs "$root"/scripts/package.json "$root"/scripts/accounts.example.json "$tmp"/
ln -s "$root/scripts/node_modules" "$tmp/node_modules" 2>/dev/null || cp -r "$root/scripts/node_modules" "$tmp/node_modules"
cd "$tmp"
node --check genimg.mjs
# the browser must be attached to and left running, never launched and closed per call
if grep -n -E 'launchPersistentContext|chromium\.launch\(' *.mjs; then echo 'a script launches its own browser per call'; exit 1; fi
grep -q 'connectOverCDP' genimg.mjs
# a call reuses the open tab: no script closes a tab, and only login opens one
if grep -n -E '\.close\(' *.mjs | grep -v -F 'browser.close('; then echo 'a script closes a tab or a context per call'; exit 1; fi
[ "$(grep -c 'newPage()' genimg.mjs)" = 2 ] || { echo 'expected exactly two newPage() sites: the no-tab fallback and login'; exit 1; }
cp accounts.example.json accounts.json
out=$(node genimg.mjs list)
echo "$out"
grep -q '^chatgpt-work .*login:NO' <<<"$out"
grep -q '^gemini-work .*login:NO' <<<"$out"
# unknown profile must fail loud before any browser launch
if node genimg.mjs gen nope "x" 2>err.txt; then echo "expected failure for unknown profile"; exit 1; fi
grep -q 'Unknown profile "nope"' err.txt
# calls on one profile dir share one tab, so a second call on a busy dir must fail loud before it touches a browser
mkdir -p profiles
node -e "require('fs').writeFileSync('profiles/work.lock', String(process.pid)); setTimeout(() => {}, 20000)" &
holder=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s profiles/work.lock ] && break; sleep 0.5; done
if WEBGEN_CHROME=/nonexistent node genimg.mjs gen chatgpt-work "x" 2>err.txt; then kill "$holder"; echo "expected failure for a busy profile dir"; exit 1; fi
kill "$holder" 2>/dev/null || true
grep -q 'Another genimg call is using profile dir "work"' err.txt
head -1 "$root/SKILL.md" | grep -q '^---$'
grep -q '^name: webgen$' "$root/SKILL.md"
echo "smoke: ok"
