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
# Build for BOTH kinds of Mac (Apple chip and Intel) and glue them into one
# program. The first install (Nov 19) was Apple-only and went onto an Intel
# Mac Pro, where it could not start at all.
# Oldest macOS it will run on: 10.15 Catalina (Intel), 11 Big Sur (Apple chip).
TMP="$(mktemp -d)"
swiftc -O -target arm64-apple-macos11.0  "$HERE/main.swift" -o "$TMP/arm64"
swiftc -O -target x86_64-apple-macos10.15 "$HERE/main.swift" -o "$TMP/x86_64"
lipo -create -output "$OUT/PRSFloRoomLock" "$TMP/arm64" "$TMP/x86_64"
rm -rf "$TMP"

# The headline font (Archivo Black, open licence — fonts/OFL.txt) and, if there
# is one, the real logo file (scripts/room-lock/logo.png, dark on clear).
mkdir -p "$OUT/fonts"
cp "$HERE/fonts/"*.ttf "$OUT/fonts/"
if [ -f "$HERE/logo.png" ]; then cp "$HERE/logo.png" "$OUT/logo.png"; fi

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
rm -rf "$DEST/fonts"; if [ -d "$SRC/fonts" ]; then cp -R "$SRC/fonts" "$DEST/fonts"; fi
rm -f "$DEST/logo.png"; if [ -f "$SRC/logo.png" ]; then cp "$SRC/logo.png" "$DEST/logo.png"; fi
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
# Do not SAY it is running — check. (The first installer printed "Installed and
# running" on a Mac where the program could not start.)
sleep 5
echo
if pgrep -f "PRSFloRoomLock/PRSFloRoomLock" >/dev/null; then
  echo "Installed and RUNNING. In PRSFlo → Room lock, this room's dot should turn green within a minute."
else
  echo "INSTALLED BUT NOT RUNNING. Send everything below to Eli:"
  echo "Mac: $(uname -m), macOS $(sw_vers -productVersion)"
  file "$DEST/PRSFloRoomLock" | cut -c1-220
  tail -5 "$DEST/agent.log" 2>/dev/null
  launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -iE "state =|last exit|spawn" | head -6
fi
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
