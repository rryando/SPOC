#!/usr/bin/env bash
# Starts the SPOC Dashboard server

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFO_FILE="${SPOC_DATA_DIR:-$HOME/.spoc}/.dashboard-info"

# Check if already running
if [ -f "$INFO_FILE" ]; then
  existing_url=$(node -e 'try{const d=require("fs").readFileSync(process.argv[1],"utf8");console.log(JSON.parse(d).url)}catch(e){}' -- "$INFO_FILE")
  if [ -n "$existing_url" ]; then
    echo "SPOC Dashboard already running at $existing_url"
    echo "$existing_url"
    exit 0
  fi
fi

export SPOC_DASHBOARD_OWNER_PID=$$
node "$SCRIPT_DIR/server.js" &
SERVER_PID=$!

# Wait for server to start (max 5s)
for i in $(seq 1 10); do
  if [ -f "$INFO_FILE" ]; then
    url=$(node -e 'try{const d=require("fs").readFileSync(process.argv[1],"utf8");console.log(JSON.parse(d).url)}catch(e){}' -- "$INFO_FILE")
    if [ -n "$url" ]; then
      echo "SPOC Dashboard started at $url"
      echo "$url"
      exit 0
    fi
  fi
  sleep 0.5
done

echo "SPOC Dashboard failed to start" >&2
exit 1
