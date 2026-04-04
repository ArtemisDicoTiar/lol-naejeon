#!/bin/bash
# Kill existing bridge if running
lsof -ti:8234 | xargs kill -9 2>/dev/null

# Open Terminal and run bridge
osascript -e '
tell application "Terminal"
  activate
  do script "cd /Users/jongyoonkim/Documents/lol/bridge && node index.js"
end tell
'
