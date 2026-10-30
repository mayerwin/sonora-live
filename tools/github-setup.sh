#!/usr/bin/env sh
# One-time setup of the GitHub repository: the About box (description, website, topics), GitHub Pages built by
# the Actions workflow, private vulnerability reporting, and the features this project does not use turned off.
# Needs the GitHub CLI (https://cli.github.com), logged in as an admin of the repository: `gh auth login`.
#
#   sh tools/github-setup.sh                 # mayerwin/sonora-live
#   sh tools/github-setup.sh owner/name      # a fork
#
# The social preview picture has no API: upload public/social/og-image.png in Settings -> General -> Social preview.

set -e
REPO="${1:-mayerwin/sonora-live}"
OWNER="${REPO%%/*}"
NAME="${REPO#*/}"
SITE="https://${OWNER}.github.io/${NAME}/"

echo "About box of $REPO"
gh repo edit "$REPO" \
  --description "Remote music lessons in the browser: peer-to-peer video, pure unprocessed instrument sound and two-way MIDI between teacher and student pianos. Low latency, no account, nothing to install." \
  --homepage "$SITE" \
  --enable-wiki=false \
  --enable-projects=false \
  --delete-branch-on-merge

echo "Topics"
gh repo edit "$REPO" --add-topic "webrtc,webmidi,midi,bluetooth-midi,music-education,music-lessons,piano,piano-lessons,remote-teaching,online-lessons,video-conferencing,p2p,peer-to-peer,low-latency,low-latency-audio,opus-audio,web-audio,pwa,preact,typescript"

echo "GitHub Pages: built and published by .github/workflows/pages.yml"
if gh api "repos/$REPO/pages" > /dev/null 2>&1; then
  gh api -X PUT "repos/$REPO/pages" -f build_type=workflow > /dev/null
else
  gh api -X POST "repos/$REPO/pages" -f build_type=workflow > /dev/null
fi

echo "Private vulnerability reporting (SECURITY.md)"
gh api -X PUT "repos/$REPO/private-vulnerability-reporting" > /dev/null || echo "  (not available for this repository)"

echo "Done: $SITE"
echo "Last step, by hand: Settings -> General -> Social preview -> upload public/social/og-image.png"
