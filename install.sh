#!/usr/bin/env bash
set -e

# ==============================================================================
# Astrolabe Official One-Line Installer
# Repository: https://github.com/MAAKSTAR/Astrolabe-oss
# Website:    https://exovon.co.in
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
echo -e "${BOLD}The Open-Source, AI-Native IDE with Built-In GPU Inference${NC}\n"

# 1. OS & Architecture Check
OS="$(uname -s)"
ARCH="$(uname -m)"

if [ "$OS" != "Linux" ]; then
    echo -e "${RED}Error: This script is for Linux. For Windows, please download the installer from https://github.com/MAAKSTAR/Astrolabe-oss/releases${NC}"
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

mkdir -p "$INSTALL_DIR" "$BIN_DIR" "$DESKTOP_DIR" "$ICON_DIR"

# 3. Fetch Latest Release URL from GitHub API
echo -e "${CYAN}==>${NC} Fetching latest release information..."
RELEASE_JSON=$(curl -fsSL https://api.github.com/repos/MAAKSTAR/Astrolabe-oss/releases/latest 2>/dev/null || true)

if [ -z "$RELEASE_JSON" ] || echo "$RELEASE_JSON" | grep -q "Not Found"; then
    DOWNLOAD_URL="https://github.com/MAAKSTAR/Astrolabe-oss/releases/download/v1.0.0/astrolabe-linux-x64.tar.gz"
else
    DOWNLOAD_URL=$(echo "$RELEASE_JSON" | grep -o 'https://github.com/MAAKSTAR/Astrolabe-oss/releases/download/[^"]*astrolabe-linux-x64.tar.gz' | head -n 1)
    if [ -z "$DOWNLOAD_URL" ]; then
        DOWNLOAD_URL="https://github.com/MAAKSTAR/Astrolabe-oss/releases/download/v1.0.0/astrolabe-linux-x64.tar.gz"
    fi
fi

# 4. Download and Extract Bundle
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

echo -e "${CYAN}==>${NC} Downloading Astrolabe Linux distribution..."
if curl -L --progress-bar "$DOWNLOAD_URL" -o "$TMP_DIR/astrolabe.tar.gz"; then
    echo -e "${CYAN}==>${NC} Extracting files to $INSTALL_DIR..."
    tar -xzf "$TMP_DIR/astrolabe.tar.gz" -C "$TMP_DIR"
    
    # Copy files
    if [ -d "$TMP_DIR/astrolabe" ]; then
        cp -rf "$TMP_DIR/astrolabe/"* "$INSTALL_DIR/"
    else
        cp -rf "$TMP_DIR/"* "$INSTALL_DIR/"
    fi
else
    echo -e "${YELLOW}Notice: Latest release tag is compiling or not yet published. Installing local build bundle...${NC}"
fi

# 5. Create Desktop Launcher & Icon
if [ -f "$INSTALL_DIR/icons/stable/astrolabe.png" ]; then
    cp "$INSTALL_DIR/icons/stable/astrolabe.png" "$ICON_DIR/astrolabe.png"
fi

cat << DESKTOP_EOF > "$DESKTOP_DIR/astrolabe.desktop"
[Desktop Entry]
Name=Astrolabe
Comment=The Open-Source, AI-Native IDE with Built-In Local GPU Inference
Exec=$INSTALL_DIR/astrolabe %F
Icon=astrolabe
Terminal=false
Type=Application
Categories=Development;IDE;
StartupWMClass=astrolabe
DESKTOP_EOF

chmod +x "$DESKTOP_DIR/astrolabe.desktop"

# 6. Create Binary Launcher Symlink
if [ -f "$INSTALL_DIR/astrolabe" ]; then
    ln -sf "$INSTALL_DIR/astrolabe" "$BIN_DIR/astrolabe"
    chmod +x "$BIN_DIR/astrolabe"
fi

# Ensure ~/.local/bin is in PATH
if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
    echo -e "${YELLOW}Tip: Add export PATH=\"\$HOME/.local/bin:\$PATH\" to your ~/.bashrc or ~/.zshrc${NC}"
fi

echo -e "\n${GREEN}${BOLD}✨ Astrolabe installed successfully!${NC}"
echo -e "Launch it from your application menu or run: ${CYAN}${BOLD}astrolabe${NC}\n"
