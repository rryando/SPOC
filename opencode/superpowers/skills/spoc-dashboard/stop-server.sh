#!/usr/bin/env bash
# Stops the SPOC Dashboard server

INFO_FILE="${SPOC_DATA_DIR:-$HOME/.spoc}/.dashboard-info"

if [ ! -f "$INFO_FILE" ]; then
  echo "SPOC Dashboard is not running"
  exit 0
fi

pid=$(node -e 'try{const d=require("fs").readFileSync(process.argv[1],"utf8");console.log(JSON.parse(d).pid)}catch(e){}' -- "$INFO_FILE")
if [ -n "$pid" ]; then
  kill "$pid" 2>/dev/null && echo "SPOC Dashboard stopped (PID $pid)" || echo "Process not found"
else
  echo "Could not read PID from $INFO_FILE"
fi

rm -f "$INFO_FILE"
