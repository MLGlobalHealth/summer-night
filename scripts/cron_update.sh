#!/usr/bin/env bash
# Cron entry point: fetch latest forecast, commit and push if it changed.
# Safe to run concurrently (flock) and logs to logs/update.log.
set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$REPO_DIR/logs"
LOG_FILE="$LOG_DIR/update.log"
LOCK_FILE="/tmp/summer-night-update.lock"

mkdir -p "$LOG_DIR"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') skipped: another update is running" >> "$LOG_FILE"
  exit 0
fi

{
  echo "=== $(date -u +'%Y-%m-%dT%H:%M:%SZ') update starting ==="
  cd "$REPO_DIR" || exit 1

  git pull --rebase --quiet origin main || echo "WARN: git pull failed, continuing with local state"

  if ! python3 scripts/update_forecast.py; then
    status=$?
    if [ "$status" -eq 1 ]; then
      echo "ERROR: fetch failed completely, nothing written; keeping previous data"
      exit 1
    fi
    echo "WARN: fetch completed with partial failures (exit $status); publishing what succeeded"
  fi

  git add data/forecast.json
  if git diff --cached --quiet; then
    echo "no changes to publish"
  else
    git commit --quiet -m "Update forecast data ($(date -u +'%Y-%m-%d %H:%M UTC'))"
    if git push --quiet origin main; then
      echo "pushed updated forecast"
    else
      echo "ERROR: git push failed; will retry on next run"
      exit 1
    fi
  fi
  echo "=== done ==="
} >> "$LOG_FILE" 2>&1

# Keep the log from growing without bound (~last 2000 lines).
tail -n 2000 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
