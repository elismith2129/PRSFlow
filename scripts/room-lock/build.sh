#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Build the Room Lock agent for ONE room (Eli, 2026-11-19).
#
#   ./scripts/room-lock/build.sh prs-a <that room's key>
#
# You don't type this by hand: PRSFlo → Admin → Room lock → "Set up this room"
# shows the exact line with the key filled in. Run it on Eli's Mac, in Terminal.
#
# It makes a folder on the Desktop — PRSFloRoomLock-<room> — holding the
# program, its settings, an installer, an uninstaller and a README. AirDrop
# that folder to the room's Mac and follow the README.
#
# The folder is written to the Desktop, NOT into the repo, on purpose: it holds
# the room's key and must never be committed.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOM="${1:-}"; KEY="${2:-}"
if [ -z "$ROOM" ] || [ -z "$KEY" ]; then
  echo "Usage: ./scripts/room-lock/build.sh <room> <key>   (copy the line from PRSFlo → Room lock → Set up this room)"; exit 1
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

if ! command -v swiftc >/dev/null 2>&1; then
  echo "Apple's developer tools are not installed on this Mac."
  echo "Run this, click Install, wait for it to finish, then run the build line again:"
  echo "    xcode-select --install"
  exit 1
fi

envval() { grep -E "^$1=" "$REPO/.env.local" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '\r'; }
URL="$(envval NEXT_PUBLIC_SUPABASE_URL)"
ANON="$(envval NEXT_PUBLIC_SUPABASE_ANON_KEY)"
if [ -z "$URL" ] || [ -z "$ANON" ]; then
  echo "Could not read NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY from .env.local"; exit 1
fi

case "$ROOM" in
  prs-*) VENUE="PARAMOUNT" ;; ars-*) VENUE="AMERAYCAN" ;; ers-*) VENUE="ENCORE" ;; trk-*) VENUE="TRACK" ;;
  *) echo "Unknown room '$ROOM'"; exit 1 ;;
esac
SUFFIX="$(echo "${ROOM#*-}" | tr '[:lower:]' '[:upper:]')"
case "$SUFFIX" in ?) LABEL="$VENUE · STUDIO $SUFFIX" ;; *) LABEL="$VENUE · $SUFFIX" ;; esac

OUT="$HOME/Desktop/PRSFloRoomLock-$ROOM"
rm -rf "$OUT"; mkdir -p "$OUT"

echo "Building…"
# Room Macs are Apple-silicon Mac Studios; build for that whatever this Mac is.
swiftc -O -target arm64-apple-macos12.0 "$HERE/main.swift" -o "$OUT/PRSFloRoomLock"

# testEscape: TEST ROOMS ONLY. Control+Option+Command+U clears a lock at the
# room. Set it to false (and re-run the installer) once the room is trusted.
cat > "$OUT/config.json" <<JSON
{
  "supabaseUrl": "$URL",
  "anonKey": "$ANON",
  "room": "$ROOM",
  "key": "$KEY",
  "roomLabel": "$LABEL",
  "testEscape": true
}
JSON

cat > "$OUT/install.command" <<'SH'
#!/bin/bash
# Installs the Room Lock agent for the person logged in on THIS Mac.
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/PRSFloRoomLock"
PLIST="$HOME/Library/LaunchAgents/com.paramount.prsflo.roomlock.plist"
LABEL="com.paramount.prsflo.roomlock"

mkdir -p "$DEST" "$HOME/Library/LaunchAgents"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
cp "$SRC/PRSFloRoomLock" "$DEST/PRSFloRoomLock"
cp "$SRC/config.json" "$DEST/config.json"
chmod 700 "$DEST"; chmod 755 "$DEST/PRSFloRoomLock"; chmod 600 "$DEST/config.json"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$DEST/PRSFloRoomLock</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$DEST/agent.log</string>
  <key>StandardErrorPath</key><string>$DEST/agent.log</string>
</dict></plist>
PL

launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo
echo "Installed and running. In PRSFlo → Room lock, this room's dot should turn green within a minute."
SH

cat > "$OUT/uninstall.command" <<'SH'
#!/bin/bash
# Removes the Room Lock agent from THIS Mac. Also the way out if a test goes wrong
# (run it over Screen Sharing / SSH, or after starting the Mac in Safe Mode).
LABEL="com.paramount.prsflo.roomlock"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
rm -rf "$HOME/Library/Application Support/PRSFloRoomLock"
osascript -e 'set volume output muted false' 2>/dev/null || true
echo "Removed."
SH
chmod +x "$OUT/install.command" "$OUT/uninstall.command"

cat > "$OUT/README.txt" <<TXT
PRSFlo Room Lock — $LABEL

ON THE ROOM'S MAC
1. Put this folder in Downloads.
2. Open Terminal and paste this one line, then press Return:

   xattr -dr com.apple.quarantine ~/Downloads/PRSFloRoomLock-$ROOM && bash ~/Downloads/PRSFloRoomLock-$ROOM/install.command

3. In PRSFlo → Admin → Room lock, the room's dot turns green within a minute.

CLEARING A LOCK
- Unlock the room in PRSFlo, or
- type the six-digit staff PIN on this Mac's keyboard and press Return
  (nothing shows on screen while you type — that is on purpose).
- While this room is still a TEST room: Control+Option+Command+U also clears it.

TO REMOVE IT
   bash ~/Downloads/PRSFloRoomLock-$ROOM/uninstall.command

Keep this folder private. It holds this room's key.
TXT

echo
echo "Done: $OUT"
echo "AirDrop that folder to the room's Mac and follow README.txt inside it."
