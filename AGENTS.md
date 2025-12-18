# Project Context: Obsidian Wasm OCR

## 1. Project Overview

**Name:** `obsidian-wasm-ocr`
**Goal:** A high-performance, offline, client-side OCR (Optical Character Recognition) plugin for Obsidian.
**Technology:**

- **Core Engine:** C++ with NCNN (Neural Network Inference Framework).
- **Models:** PP-OCRv5 (Quantized/Lightweight).
- **Platform:** WebAssembly (Wasm) via Emscripten.
- **Frontend:** TypeScript (Obsidian API), React, Zustand.
- **Architecture:** Web Worker (Off-main-thread processing).

## 2. Architecture & Design Decisions

### A. The Core (`@core/`)

- **Engine:** `src/ocr_engine.cpp` implements the OCR pipeline.
- **Validation:** Added robust validation in `detect_text` to ignore degenerate bounding boxes (e.g., aspect ratio > 1:120 or < 1:120) to prevent memory issues during warping.
- **Memory:**
  - `MAXIMUM_MEMORY` increased to 2GB (`2048MB`) to handle continuous processing and large images.
  - `INITIAL_MEMORY` set to 256MB.
- **Models:** Stored in `core/models/`, packaged via `fs` read in main thread and transferred to Worker VFS.

### B. The Web Worker (`@plugin/worker/`)

- **Why:** To prevent UI freezing during heavy NCNN inference.
- **Implementation:**
  - **Source:** `src/plugin/worker/ocr-worker.ts`.
  - **Build:** Compiles to a string (Blob) via a custom `esbuild` plugin (`workerPlugin`) and injected into the main bundle.
  - **Loading:** Loaded via `URL.createObjectURL(blob)` in `OcrEngine.ts`.
  - **Communication:** Uses `postMessage` with **Transferable Objects** (`ArrayBuffer`) for zero-copy image data transfer.
  - **VFS:** Main thread reads model files and sends them to Worker during initialization; Worker writes them to Emscripten VFS.

### C. The Plugin (`@plugin/`)

- **State Management:** `src/plugin/models/store.ts` (Zustand).
  - **Caching:** Implements LRU Caching (`resultsCache`) mapping File Path -> OCR Results.
  - **Persistance:** Preserves results when switching active notes.
- **UI Components:**
  - **ImagePreview:**
    - Supports **Swipe/Scroll** navigation between multiple images.
    - **Selection:** Distinguishes Single Click (Select Box) vs Drag (Select Text Range). Double Click selects whole box.
    - **Layout:** Min-height wrapper to prevent layout jumping.
  - **ResultList:**
    - **Merge Lines:** Toggle button to merge broken lines into paragraphs based on geometry and punctuation.
    - **Smart Sorting:** Groups boxes into lines (Y-banding) before sorting.
    - **Selection Support:** Copy button respects user click order if manual selection is active.
- **Features:**
  - **Auto-OCR:** Detects pasted images (`editor-paste` + `vault.create`) and auto-analyzes them after a delay (configurable).
  - **Multi-Image:** Scans entire notes for images (Internal Embeds + External Links).

## 3. Directory Structure

```text
/
├── core/                   # C++ / Wasm Source
│   ├── CMakeLists.txt      # Memory limits: 2GB
│   ├── src/
│       ├── ocr_engine.cpp  # Core Logic with aspect ratio safeguards
│       ├── main.cpp        # Emscripten Bindings
├── plugin/                 # Obsidian Plugin Source
│   ├── esbuild.config.mjs  # Includes 'workerPlugin' for inline worker build
│   ├── src/
│   │   ├── main.ts         # Plugin Entry, Auto-OCR logic, Settings
│   │   ├── settings.ts     # Settings Tab (Auto-Open, Merge defaults)
│   │   ├── worker/         # Worker Logic
│   │   │   └── ocr-worker.ts
│   │   ├── services/
│   │   │   └── OcrEngine.ts # Client-side Proxy for Worker
│   │   ├── models/
│   │   │   └── store.ts    # Zustand Store with Caching
│   │   ├── components/
│   │   │   ├── ImagePreview.tsx # Interactive UI
│   │   │   └── ResultList.tsx   # Merge Logic & Text Display
```

## 4. Build & Development Workflow

### Prerequisites

- **EMSDK** (Emscripten SDK).
- **Node.js** & **Yarn**.

### Step 1: Build Core (Wasm)

```bash
./scripts/build.sh
```

- Compiles C++ to Wasm.
- Copies artifacts to `plugin/build/wasm-artifacts/`.

### Step 2: Build Plugin

```bash
cd plugin
yarn install
yarn build
```

- `esbuild` compiles `ocr-worker.ts` in-memory.
- Bundles `main.ts` (with inline worker) -> `main.js`.

## 5. Critical Implementation Details

- **Worker Bundling:** `esbuild.config.mjs` marks `fs`, `path`, `crypto` as external for the worker build to avoid resolving Node.js built-ins in the browser environment.
- **Hook Order:** In `ResultList.tsx`, `useMemo` must be called unconditionally before any early returns to avoid React errors.
- **Caching:** `main.ts` checks `store.loadFromCache(path)` before running OCR. If found, it skips processing.
- **Auto-OCR:** Uses a 1.5s time window to correlate `editor-paste` events with `vault.create` events.

## 6. Current Status

- **Core:** Stable. Memory leaks addressed via higher limits and input validation.
- **Performance:** Excellent (Web Worker offloads CPU).
- **UX:** polished (Swipe, Scroll, Smart Merge, Caching).
- **Next Steps:** None immediate. Feature set is complete for v1.
