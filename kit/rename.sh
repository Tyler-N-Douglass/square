#!/usr/bin/env bash
# Swap the app name across the project, wherever the kit files ended up.
# Run from the project root: ./kit/rename.sh NEWNAME
#
# The TOOLS are named SCAN, LEVEL, CORNER, LAYOUT, BEVEL, CALIBRATE, LOG. Tool #3 is
# deliberately CORNER and not SQUARE so the app and the tool never collide — leave it alone.
set -euo pipefail
NEW="${1:?usage: ./kit/rename.sh NEWNAME}"
ROOT="${2:-.}"
mapfile -t FILES < <(grep -rlZ --binary-files=without-match -E '\bSQUARE\b' "$ROOT" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  --exclude-dir=coverage --exclude-dir=.netlify 2>/dev/null | tr '\0' '\n')
if [ "${#FILES[@]}" -eq 0 ]; then echo "Nothing to rename under $ROOT"; exit 0; fi
for f in "${FILES[@]}"; do
  sed -i.bak "s/\bSQUARE\b/$NEW/g" "$f" && rm -f "$f.bak"
  echo "  renamed: $f"
done
echo "Done — ${#FILES[@]} files now say $NEW. Tool names untouched, which is correct."
