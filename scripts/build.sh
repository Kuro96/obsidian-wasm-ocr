#!/bin/bash
set -e

# ==============================================================================
# Unified Build Script for Obsidian Wasm OCR
# Usage: ./scripts/build.sh [target] [--mode <Release|Debug|RelWithDebInfo>]
# Targets: plugin (default), test, benchmark
# ==============================================================================

# Paths
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_CORE="$ROOT_DIR/src/core"
SRC_PLUGIN="$ROOT_DIR/src/plugin"
DIST_DIR="$ROOT_DIR/dist"
PLUGIN_DIST="$DIST_DIR/obsidian-wasm-ocr"

# Defaults
TARGET="plugin"
BUILD_MODE="Release"
NCNN_VARIANT="simd" # Default variant

# ------------------------------------------------------------------------------
# 1. Parse Arguments
# ------------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  key="$1"
  case $key in
    plugin|test|benchmark)
      TARGET="$key"
      shift
      ;; 
    -m|--mode)
      BUILD_MODE="$2"
      shift 2
      ;; 
    -h|--help)
      echo "Usage: ./scripts/build.sh [target] [options]"
      echo ""
      echo "Targets:"
      echo "  plugin     (Default) Build Obsidian Plugin (Wasm + TS)"
      echo "  test       Build Browser Test (Test Wasm + WWW)"
      echo "  benchmark  Build Benchmark Suite (All Variants + WWW)"
      echo ""
      echo "Options:"
      echo "  --mode <mode>    Build Mode: Release (default), Debug, RelWithDebInfo"
      echo "                   RelWithDebInfo is recommended for profiling."
      echo "  --variant <variant> NCNN variant: basic, simd (default for plugin/test), threads, simd-threads"
      exit 0
      ;; 
    --variant)
      NCNN_VARIANT="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;; 
  esac
done

echo "=========================================="
echo "Target: $TARGET"
echo "Mode:   $BUILD_MODE"
echo "Variant: $NCNN_VARIANT"
echo "=========================================="

# Check EMSDK
if ! command -v emcmake &> /dev/null; then
    echo "Error: emcmake not found. Please activate EMSDK!"
    exit 1
fi

# ------------------------------------------------------------------------------
# 2. Build Functions
# ------------------------------------------------------------------------------

# $1: Build Directory, $2: Variant, $3: CMake Target, $4: Export Name (Optional)
compile_wasm() {
    local BUILD_DIR="$1"
    local CURRENT_VARIANT="$2"
    local MAKE_TARGET="$3"
    local EXPORT_NAME="$4"

    echo "-> Compiling $MAKE_TARGET ($CURRENT_VARIANT) in $BUILD_DIR..."
    
    if [ -d "$BUILD_DIR" ]; then rm -rf "$BUILD_DIR"; fi
    mkdir -p "$BUILD_DIR" && cd "$BUILD_DIR"

    local CMAKE_ARGS="-DNCNN_VARIANT=$CURRENT_VARIANT -DCMAKE_BUILD_TYPE=$BUILD_MODE"
    if [ -n "$EXPORT_NAME" ]; then
        CMAKE_ARGS="$CMAKE_ARGS -DTEST_EXPORT_NAME=$EXPORT_NAME"
    fi

    emcmake cmake "$SRC_CORE" $CMAKE_ARGS
    emmake make "$MAKE_TARGET" -j4
}

build_plugin() {
    # 1. Clean Dist
    rm -rf "$DIST_DIR"
    mkdir -p "$PLUGIN_DIST/models"

    # 2. Build Wasm (Core)
    compile_wasm "$ROOT_DIR/build/core" "$NCNN_VARIANT" "ocr-wasm" ""

    # 3. Copy Wasm Artifacts for esbuild
    echo "-> Staging Wasm artifacts..."
    mkdir -p "$ROOT_DIR/build/wasm-artifacts"
    cp ocr-wasm.js ocr-wasm.wasm "$ROOT_DIR/build/wasm-artifacts/"

    # 4. Copy Models
    echo "-> Copying Models..."
    cp "$ROOT_DIR/assets/models/"* "$PLUGIN_DIST/models/"

    # 5. Build TS Plugin
    echo "-> Building Plugin (TypeScript)..."
    cd "$SRC_PLUGIN"
    if [ ! -d "node_modules" ]; then yarn install; fi
    yarn build

    # 6. Finalize
    echo "-> Finalizing..."
    cp manifest.json "$PLUGIN_DIST/"
    if [ -f "styles.css" ]; then cp styles.css "$PLUGIN_DIST/"; fi
    if [ -f "main.js" ]; then mv main.js "$PLUGIN_DIST/"; fi

    echo "SUCCESS: Plugin built at $PLUGIN_DIST"
}

build_test() {
    local BUILD_DIR="$ROOT_DIR/build/test"
    local WWW_ROOT="$BUILD_DIR/www"

    # 1. Build Wasm (Test Target)
    compile_wasm "$BUILD_DIR" "$NCNN_VARIANT" "test-wasm" ""

    # 2. Assemble Website
    echo "-> Assembling Test Site in $WWW_ROOT..."
    rm -rf "$WWW_ROOT" && mkdir -p "$WWW_ROOT"

    # Copy artifacts
    cp test-wasm.js test-wasm.wasm "$WWW_ROOT/"
    if [ -f "test-wasm.data" ]; then cp test-wasm.data "$WWW_ROOT/"; fi

    # Copy Web Sources (index.html, etc)
    cp -r "$ROOT_DIR/tests/web/"* "$WWW_ROOT/"
    # Remove benchmark folder from this view to avoid confusion (optional)
    rm -rf "$WWW_ROOT/benchmark"

    # Copy Models (Explicitly needed for test web server if not VFS-packed, 
    # but our CMake uses --preload-file so they are in .data. 
    # However, copying them doesn't hurt and helps if we switch loading methods.)
    mkdir -p "$WWW_ROOT/models"
    cp "$ROOT_DIR/assets/models/"* "$WWW_ROOT/models/"

    echo "SUCCESS: Test built at $WWW_ROOT"
    echo "Run server: python3 scripts/serve_test.py \"$WWW_ROOT\""
}

build_benchmark() {
    local BASE_BUILD_DIR="$ROOT_DIR/build/benchmark_build"
    local WWW_ROOT="$ROOT_DIR/build/benchmark/www"

    echo "-> Cleaning Benchmark Output..."
    rm -rf "$BASE_BUILD_DIR" "$WWW_ROOT"
    mkdir -p "$WWW_ROOT"

    # 1. Copy Base Website
    cp -r "$ROOT_DIR/tests/web/"* "$WWW_ROOT/"
    
    # 2. Build All Variants
    local VARIANTS=("basic" "simd" "threads" "simd-threads")
    
    for v in "${VARIANTS[@]}"; do
        # Export name must match what the benchmark JS expects (createTestModuleBasic, etc.)
        local EXPORT_SUFFIX=""
        if [ "$v" == "basic" ]; then EXPORT_SUFFIX="Basic"; fi
        if [ "$v" == "simd" ]; then EXPORT_SUFFIX="Simd"; fi
        if [ "$v" == "threads" ]; then EXPORT_SUFFIX="Threads"; fi
        if [ "$v" == "simd-threads" ]; then EXPORT_SUFFIX="SimdThreads"; fi
        
        local EXPORT_NAME="createTestModule$EXPORT_SUFFIX"
        
        compile_wasm "$BASE_BUILD_DIR/$v" "$v" "test-wasm" "$EXPORT_NAME"

        # Copy to WWW
        local DEST="$WWW_ROOT/benchmark/$v"
        mkdir -p "$DEST"
        cp test-wasm.js test-wasm.wasm "$DEST/"
        if [ -f "test-wasm.data" ]; then cp test-wasm.data "$DEST/" ; fi
    done

    echo "SUCCESS: Benchmarks built at $WWW_ROOT"
    echo "Run server: python3 scripts/serve_test.py \"$WWW_ROOT\""
}

# ------------------------------------------------------------------------------
# 3. Execution Switch
# ------------------------------------------------------------------------------
if [ "$TARGET" == "plugin" ]; then
    build_plugin
elif [ "$TARGET" == "test" ]; then
    build_test
elif [ "$TARGET" == "benchmark" ]; then
    build_benchmark
else
    echo "Error: Unknown target $TARGET"
    exit 1
fi
