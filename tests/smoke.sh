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
node --check probe.mjs
cp accounts.example.json accounts.json
out=$(node genimg.mjs list)
echo "$out"
grep -q '^chatgpt-work .*login:NO' <<<"$out"
grep -q '^gemini-work .*login:NO' <<<"$out"
# unknown profile must fail loud before any browser launch
if node genimg.mjs gen nope "x" 2>err.txt; then echo "expected failure for unknown profile"; exit 1; fi
grep -q 'Unknown profile "nope"' err.txt
head -1 "$root/SKILL.md" | grep -q '^---$'
grep -q '^name: webgen$' "$root/SKILL.md"
echo "smoke: ok"
