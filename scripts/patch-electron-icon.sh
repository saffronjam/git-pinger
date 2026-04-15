#!/bin/sh
# Replaces the default Electron icon with the GitPinger icon in dev mode
ELECTRON_ICNS="node_modules/electron/dist/Electron.app/Contents/Resources/electron.icns"
GITPINGER_ICNS="resources/icon.icns"

if [ -f "$ELECTRON_ICNS" ] && [ -f "$GITPINGER_ICNS" ]; then
  cp "$GITPINGER_ICNS" "$ELECTRON_ICNS"
  echo "Patched Electron dev icon with GitPinger icon"
fi
