#!/usr/bin/env bash
# Refresh the slow-moving datasets for the epi site: excess mortality (weekly is
# plenty) and, when asked, the ERA5 climatology (monthly). Commits & pushes any
# changes. Run from cron; logs to logs/data.log.
#
#   scripts/cron_data.sh              # mortality only
#   scripts/cron_data.sh climatology  # mortality + rebuild climatology
set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$REPO_DIR/logs"; LOG_FILE="$LOG_DIR/data.log"
LOCK_FILE="/tmp/summer-night-data.lock"
mkdir -p "$LOG_DIR"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') skipped: another data run is active" >> "$LOG_FILE"; exit 0
fi

{
  echo "=== $(date -u +'%Y-%m-%dT%H:%M:%SZ') data refresh starting ($*) ==="
  cd "$REPO_DIR" || exit 1
  git pull --rebase --quiet origin main || echo "WARN: git pull failed"

  python3 scripts/update_mortality.py || echo "WARN: mortality update exit $?"
  if [ "${1:-}" = "climatology" ]; then
    python3 scripts/build_climatology.py --force || echo "WARN: climatology build exit $?"
  fi

  git add data/mortality.json data/climatology.json 2>/dev/null
  if git diff --cached --quiet; then
    echo "no dataset changes"
  else
    git commit --quiet -m "Update epi datasets ($(date -u +'%Y-%m-%d %H:%M UTC'))"
    git push --quiet origin main && echo "pushed dataset update" || echo "ERROR: push failed"
  fi
  echo "=== done ==="
} >> "$LOG_FILE" 2>&1

tail -n 2000 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
