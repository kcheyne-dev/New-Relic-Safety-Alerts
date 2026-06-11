#!/usr/bin/env bash
# Build dated PDF versions of the user manual + quick reference.
# Uses headless Chrome — already installed on your Mac.
#
# Usage:
#   cd "/Users/kcheyne/Documents/Claude/Projects/New Relic Safety Alerts"
#   ./docs/build-pdfs.sh
#
# Output goes to docs/pdf/ named user-manual-YYYY-MM-DD.pdf and
# quick-reference-YYYY-MM-DD.pdf so you keep a dated history.

set -euo pipefail

# Resolve repo root from script location so the script works from any cwd
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

DATE="$(date +%Y-%m-%d)"
PDF_DIR="$REPO_ROOT/docs/pdf"
mkdir -p "$PDF_DIR"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [[ ! -x "$CHROME" ]]; then
  echo "Error: Google Chrome not found at $CHROME"
  echo "Edit this script to point CHROME at your Chrome binary, or install Chrome."
  exit 1
fi

build_pdf() {
  local src="$1"
  local out="$2"
  echo "→ Building $out from $src"
  "$CHROME" \
    --headless=new \
    --disable-gpu \
    --no-pdf-header-footer \
    --hide-scrollbars \
    --print-to-pdf="$out" \
    --print-to-pdf-no-header \
    --virtual-time-budget=4000 \
    "file://$src" \
    2>/dev/null
  echo "  Saved: $out ($(du -h "$out" | cut -f1))"
}

build_pdf "$REPO_ROOT/docs/user-manual.html"   "$PDF_DIR/user-manual-$DATE.pdf"
build_pdf "$REPO_ROOT/docs/quick-reference.html" "$PDF_DIR/quick-reference-$DATE.pdf"

echo ""
echo "✓ Done. PDFs saved to:"
echo "  $PDF_DIR/user-manual-$DATE.pdf"
echo "  $PDF_DIR/quick-reference-$DATE.pdf"
