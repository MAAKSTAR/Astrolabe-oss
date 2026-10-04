#!/usr/bin/env bash
set -e

# ==============================================================================
# Astrolabe Official One-Line Installer
# Repository: https://github.com/MAAKSTAR/Astrolabe-oss
# Website:    https://exovon.in
# ==============================================================================

# Color formatting
BOLD='\033[1m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${CYAN}${BOLD}"
echo "    ___         __             __      __        "
echo "   /   |  _____/ /__________  / /___ _/ /_  ___  "
echo "  / /| | / ___/ __/ ___/ __ \/ / __ \`/ __ \/ _ \ "
echo " / ___ |(__  ) /_/ /  / /_/ / / /_/ / /_/ /  __/ "
echo "/_/  |_/____/\__/_/   \____/_/\__,_/_.___/\___/  "
echo -e "${NC}"
echo -e "${BOLD}The Open-Source, AI-Native IDE with Built-In Local GPU Inference${NC}\n"

# 1. OS & Architecture Check
OS="$(uname -s)"
ARCH="$(uname -m)"

if [ "$OS" != "Linux" ]; then
    echo -e "${RED}Error: This script is for Linux. For Windows, please download from https://github.com/MAAKSTAR/Astrolabe-oss/releases${NC}"
    exit 1
fi

if [ "$ARCH" != "x86_64" ]; then
    echo -e "${RED}Error: Unsupported architecture: $ARCH. Astrolabe currently supports x86_64.${NC}"
    exit 1
fi

# 2. Installation Directory Setup
INSTALL_DIR="$HOME/.local/share/astrolabe"
BIN_DIR="$HOME/.local/bin"
DESKTOP_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor/512x512/apps"
ICON_ROOT_DIR="$HOME/.local/share/icons"

mkdir -p "$INSTALL_DIR" "$BIN_DIR" "$DESKTOP_DIR" "$ICON_DIR" "$ICON_ROOT_DIR"

# 3. Fetch Latest Release URL
echo -e "${CYAN}==>${NC} Fetching latest release information..."
DOWNLOAD_URL="https://github.com/MAAKSTAR/Astrolabe-oss/releases/latest/download/astrolabe-linux-x64.tar.gz"

# 4. Download and Extract Bundle
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

echo -e "${CYAN}==>${NC} Downloading Astrolabe Linux distribution..."
if curl -fL --progress-bar "$DOWNLOAD_URL" -o "$TMP_DIR/astrolabe.tar.gz"; then
    echo -e "${CYAN}==>${NC} Extracting files to $INSTALL_DIR..."
    tar -xzf "$TMP_DIR/astrolabe.tar.gz" -C "$TMP_DIR"
    
    if [ -d "$TMP_DIR/astrolabe" ]; then
        cp -rf "$TMP_DIR/astrolabe/"* "$INSTALL_DIR/"
    else
        cp -rf "$TMP_DIR/"* "$INSTALL_DIR/"
    fi
    
    chmod +x "$INSTALL_DIR/astrolabe" 2>/dev/null || true
    chmod +x "$INSTALL_DIR/bin/astrolabe" 2>/dev/null || true
else
    echo -e "${RED}Error: Failed to download Astrolabe from $DOWNLOAD_URL${NC}"
    exit 1
fi

# 5. Guarantee Permanent Icon Installation
PIXMAPS_DIR="$HOME/.local/share/pixmaps"
mkdir -p "$PIXMAPS_DIR"
ICON_PATH="$INSTALL_DIR/astrolabe.png"
if [ ! -f "$ICON_PATH" ]; then
    if [ -f "$INSTALL_DIR/icons/stable/astrolabe.png" ]; then
        cp "$INSTALL_DIR/icons/stable/astrolabe.png" "$ICON_PATH"
    else
        curl -fsSL "https://raw.githubusercontent.com/MAAKSTAR/Astrolabe-oss/main/icons/stable/astrolabe.png" -o "$ICON_PATH" 2>/dev/null || true
    fi
fi

# Copy icon to all standard system icon caches
if [ -f "$ICON_PATH" ]; then
    cp -f "$ICON_PATH" "$ICON_DIR/astrolabe.png"
    cp -f "$ICON_PATH" "$ICON_ROOT_DIR/astrolabe.png"
    cp -f "$ICON_PATH" "$PIXMAPS_DIR/astrolabe.png"
fi

# 6. Create Permanent Desktop Launcher Entry
cat << DESKTOP_EOF > "$DESKTOP_DIR/astrolabe.desktop"
[Desktop Entry]
Version=1.0
Name=Astrolabe
GenericName=AI-Native IDE
Comment=The Open-Source, AI-Native IDE with Built-In Local GPU Inference
Exec=$INSTALL_DIR/astrolabe --no-sandbox --ozone-platform-hint=auto --enable-features=WaylandWindowDecorations %F
Icon=astrolabe
Terminal=false
Type=Application
Categories=Development;IDE;TextEditor;
MimeType=text/plain;inode/directory;
StartupWMClass=astrolabe
StartupNotify=true
Actions=new-empty-window;
Keywords=astrolabe;exovon;ai;ide;code;developer;

[Desktop Action new-empty-window]
Name=New Empty Window
Exec=$INSTALL_DIR/astrolabe --no-sandbox --ozone-platform-hint=auto --enable-features=WaylandWindowDecorations --new-window %F
Icon=astrolabe
DESKTOP_EOF

chmod +x "$DESKTOP_DIR/astrolabe.desktop"

# Refresh desktop and icon databases
update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true

# 7. Create Binary Launcher Symlink in PATH
if [ -f "$INSTALL_DIR/bin/astrolabe" ]; then
    ln -sf "$INSTALL_DIR/bin/astrolabe" "$BIN_DIR/astrolabe"
elif [ -f "$INSTALL_DIR/astrolabe" ]; then
    ln -sf "$INSTALL_DIR/astrolabe" "$BIN_DIR/astrolabe"
fi
chmod +x "$BIN_DIR/astrolabe" 2>/dev/null || true

# Ensure ~/.local/bin is in PATH in shell rc files
for RC_FILE in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
    if [ -f "$RC_FILE" ] && ! grep -q '.local/bin' "$RC_FILE"; then
        echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$RC_FILE"
    fi
done

echo -e "\n${GREEN}${BOLD}✨ Astrolabe installed permanently!${NC}"
echo -e "Launch it from your OS App Menu or run: ${CYAN}${BOLD}astrolabe${NC}\n"
