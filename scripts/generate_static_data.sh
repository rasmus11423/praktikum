#!/usr/bin/env bash
# Generates public/data/internships.json — the static snapshot the
# GitHub Pages build ships instead of a live /api/internships endpoint.
#
# Runs the real C++ backend briefly against data/internships.csv (so the
# snapshot goes through the exact same parsing/expired-deadline filtering as
# local dev) and dumps its output to a file. Used both for local testing of
# the static build and by .github/workflows/deploy.yml in CI.
set -euo pipefail

cd "$(dirname "$0")/.."

BUILD_DIR="${BUILD_DIR:-build}"
PORT="${PORT:-8123}"

if [ ! -x "$BUILD_DIR/internship_server" ]; then
  echo "Building internship_server..."
  cmake -S . -B "$BUILD_DIR" -DCMAKE_BUILD_TYPE=Release
  cmake --build "$BUILD_DIR" --parallel
fi

# UserStore treats a missing file as "no users yet" but errors on an empty
# one, so point it at a path inside a fresh temp dir rather than a
# pre-created (and therefore empty) temp file.
USERDATA_DIR="$(mktemp -d -t praktikaportaal_userdata.XXXXXX)"
USERDATA_TMP="$USERDATA_DIR/users.json"
trap 'rm -rf "$USERDATA_DIR"' EXIT

PORT="$PORT" USER_DATA_PATH="$USERDATA_TMP" "./$BUILD_DIR/internship_server" &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$USERDATA_DIR"' EXIT

echo "Waiting for server on port $PORT..."
for _ in $(seq 1 30); do
  if curl -s -o /dev/null "http://localhost:$PORT/api/internships"; then
    break
  fi
  sleep 0.5
done

mkdir -p public/data
curl -sf "http://localhost:$PORT/api/internships" -o public/data/internships.json

kill "$SERVER_PID" 2>/dev/null || true
trap - EXIT
rm -f "$USERDATA_TMP"

COUNT=$(grep -o '"id"' public/data/internships.json | wc -l | tr -d ' ')
echo "Wrote public/data/internships.json ($COUNT active postings)"
