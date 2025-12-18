# Obsidian Wasm OCR

A high-performance, offline, client-side OCR (Optical Character Recognition) plugin for Obsidian, powered by NCNN and WebAssembly.

## Features

- **Offline Privacy**: All processing happens locally on your device. No data leaves your machine.
- **High Performance**: Uses WebAssembly and Web Workers to run the PP-OCRv5 model efficiently without freezing the UI.
- **Multi-Image Support**: Batch analyze images from your clipboard, current note, or selection.
- **Interactive Analysis**:
  - **Visual Selection**: Drag to select text blocks, draw marquees to select multiple regions.
  - **Zoom & Pan**: Inspect high-resolution scans with ease.
  - **Smart Merge**: Automatically merges broken lines into coherent paragraphs.

## Usage Guide

### Getting Started

1.  **Paste & Auto-OCR**: Paste an image into your note. If "Auto-OCR on Paste" is enabled in settings, it will be analyzed automatically.
2.  **Context Menu**: Right-click any image in your note and select **"Analyze Image"**.
3.  **Command Palette**: Use commands like **"Analyze Current Image"** or **"Analyze All Images in Note"**.

### Interactive Viewer

When the analysis panel opens, you can interact with the image and results:

| Action           | Interaction                                                                                                                                                      |
| :--------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Select Text**  | **Left Click + Drag** over text.                                                                                                                                 |
| **Select Block** | **Double Click** on a text box.                                                                                                                                  |
| **Multi-Select** | **Ctrl/Cmd + Drag** to draw a selection box (Add). <br> **Shift + Drag** to draw a selection box (Remove). <br> **Ctrl/Cmd + Click** to toggle individual boxes. |
| **Pan Image**    | **Middle Mouse Button Drag**.                                                                                                                                    |
| **Zoom**         | **Mouse Wheel** (Zooms to canvas center).                                                                                                                        |
| **Navigate**     | **Left/Right Arrow Keys**, or drag/click the top progress bar.                                                                                                   |
| **Reset View**   | Click the **Reset** icon (top-right of image).                                                                                                                   |

### Text Management

- **Copy**: Click the "Copy" button at the bottom. It respects your current selection and sorting.
- **Merge Lines**: Toggle the "Merge Lines" switch to combine broken text into paragraphs automatically.

## Settings

- **Text Confidence Threshold**: Adjust the slider to filter out low-confidence text detections (0.0 - 1.0).
- **Auto-OCR**: Enable/Disable automatic analysis on paste.
- **Auto-Open Panel**: Choose whether the side panel opens automatically when analysis starts.

## Technical Details

- **Core**: C++ with NCNN inference engine.
- **Model**: PP-OCRv5 (Quantized).
- **Frontend**: React + Zustand.

## License

GPLv3
