#!/usr/bin/env bash
# ==============================================================================
# Astrolabe All-In-One Open Source Master Build Script
# Compiles the Rust inference engine, Motion Studio, and the Extension.
# ==============================================================================
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "========================================================"
echo "   Astrolabe All-In-One Open Source Build Pipeline      "
echo "========================================================"

echo ""
echo ">>> [1/3] Building Native AI Engine (Rust / Vulkan) <<<"
cd "$REPO_ROOT/daemon"
cargo build --release
echo "✓ Native AI Engine built successfully at daemon/target/release/exovon-daemon"

echo ""
echo ">>> [2/3] Building Astrolabe Motion Studio (AMS) <<<"
cd "$REPO_ROOT/apps/astrolabe-motion-studio"
npm run build
echo "✓ Astrolabe Motion Studio built successfully"

echo ""
echo ">>> [3/3] Building ExovonHub Built-in Extension <<<"
cd "$REPO_ROOT/src/stable/extensions/exovonhub"
npm run compile
echo "✓ ExovonHub extension compiled successfully"

echo ""
echo "========================================================"
echo "   All Astrolabe subsystems compiled with 0 errors!     "
echo "========================================================"
