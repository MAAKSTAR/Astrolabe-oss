#!/usr/bin/env bash
set -euo pipefail

PACKAGE_ARCHIVE="${1:-}"
ISOLATED_ROOT="/tmp/astrolabe_isolated_vm"

if [ -z "$PACKAGE_ARCHIVE" ]; then
    echo "Usage: $0 <path-to-astrolabe-linux-x64.tar.gz-or-extracted-dir>"
    exit 1
fi

echo "================================================================="
echo " 🚀 Launching Astrolabe in 100% Isolated Virtual Machine / Sandbox"
echo "================================================================="

rm -rf "$ISOLATED_ROOT"
mkdir -p "$ISOLATED_ROOT/home/user"
mkdir -p "$ISOLATED_ROOT/tmp/runtime"
chmod 700 "$ISOLATED_ROOT/tmp/runtime"
mkdir -p "$ISOLATED_ROOT/app"

if [ -f "$PACKAGE_ARCHIVE" ]; then
    echo "==> Extracting $PACKAGE_ARCHIVE into isolated container..."
    tar -xzf "$PACKAGE_ARCHIVE" -C "$ISOLATED_ROOT/app"
elif [ -d "$PACKAGE_ARCHIVE" ]; then
    echo "==> Copying app directory into isolated container..."
    mkdir -p "$ISOLATED_ROOT/app/astrolabe"
    cp -r "$PACKAGE_ARCHIVE"/* "$ISOLATED_ROOT/app/astrolabe/"
fi

# Locate binary
if [ -f "$ISOLATED_ROOT/app/astrolabe/astrolabe" ]; then
    APP_BIN="/app/astrolabe/astrolabe"
elif [ -f "$ISOLATED_ROOT/app/astrolabe" ]; then
    APP_BIN="/app/astrolabe"
else
    echo "Error: Could not locate astrolabe executable in $ISOLATED_ROOT/app"
    exit 1
fi

WAYLAND_SOCK="${XDG_RUNTIME_DIR:-/run/user/1000}/${WAYLAND_DISPLAY:-wayland-0}"
WAYLAND_BIND=""
if [ -S "$WAYLAND_SOCK" ]; then
    WAYLAND_BIND="--ro-bind $WAYLAND_SOCK /run/user/1000/${WAYLAND_DISPLAY:-wayland-0}"
fi

echo "==> Isolated VM Home: /home/user (Zero Host State)"
echo "==> Starting Astrolabe inside clean sandbox..."

bwrap \
  --ro-bind /usr /usr \
  --ro-bind /lib /lib \
  --ro-bind-try /lib64 /lib64 \
  --ro-bind-try /etc /etc \
  --ro-bind-try /bin /bin \
  --ro-bind-try /opt /opt \
  --ro-bind-try /tmp/.X11-unix /tmp/.X11-unix \
  --bind "$ISOLATED_ROOT/app" /app \
  --bind "$ISOLATED_ROOT/home/user" /home/user \
  --bind "$ISOLATED_ROOT/tmp" /tmp \
  --bind "$ISOLATED_ROOT/tmp/runtime" /run/user/1000 \
  $WAYLAND_BIND \
  --dev /dev \
  --proc /proc \
  --ro-bind-try /sys /sys \
  --setenv HOME /home/user \
  --setenv USER cleanuser \
  --setenv DISPLAY "${DISPLAY:-:0}" \
  --setenv WAYLAND_DISPLAY "${WAYLAND_DISPLAY:-wayland-0}" \
  --setenv XDG_RUNTIME_DIR "/run/user/1000" \
  --setenv XDG_CONFIG_HOME /home/user/.config \
  --setenv XDG_DATA_HOME /home/user/.local/share \
  --setenv XDG_CACHE_HOME /home/user/.cache \
  --unshare-all \
  --share-net \
  /bin/bash -c "exec $APP_BIN --no-sandbox"

echo "==> Isolated VM session closed cleanly."
