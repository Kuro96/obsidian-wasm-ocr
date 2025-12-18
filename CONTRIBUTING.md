# Contributing to Obsidian Wasm OCR

Thank you for your interest in contributing to Obsidian Wasm OCR! We welcome contributions from everyone.

## Getting Started

### Prerequisites

To build and develop this project, you will need:

1.  **Node.js** and **Yarn**: For building the Obsidian plugin frontend.
2.  **Emscripten SDK (emsdk)**: For compiling the C++ core to WebAssembly.
3.  **Python** and **pre-commit**: For code formatting and linting checks.

### Setting up the Environment

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/Kuro96/obsidian-wasm-ocr.git
    cd wasm-ocr
    ```

2.  **Install dependencies:**

    ```bash
    cd src/plugin
    yarn install
    ```

3.  **Setup Pre-commit Hooks:**
    To ensure code style consistency, please install and activate pre-commit hooks.

    ```bash
    pip install pre-commit
    pre-commit install
    ```

4.  **Setup Emscripten:**
    Follow the [official Emscripten installation guide](https://emscripten.org/docs/getting_started/downloads.html) to install and activate the SDK. Ensure `emcmake` and `emmake` are in your PATH.

## Building the Project

We provide a unified build script to handle both the Wasm compilation and the Plugin bundling.

```bash
# Build the Obsidian Plugin (Wasm + TS)
./scripts/build.sh plugin
```

The build artifacts will be output to `dist/obsidian-wasm-ocr/`.

### Other Build Targets

- **Test:** Builds the test suite.
  ```bash
  ./scripts/build.sh test
  ```
- **Benchmark:** Builds the benchmarking suite.
  ```bash
  ./scripts/build.sh benchmark
  ```

## Project Structure

- **`src/core/`**: C++ source code for the OCR engine and NCNN inference.
- **`src/plugin/`**: TypeScript source code for the Obsidian plugin UI and logic.
- **`scripts/`**: Build and utility scripts.
- **`assets/models/`**: Pre-trained NCNN models.

## Submitting Changes

1.  **Fork the repository** and create your branch from `main`.
2.  **Make your changes**. Ensure your code follows the existing style and conventions.
3.  **Test your changes**. Run the build script to ensure everything compiles correctly.
4.  **Submit a Pull Request**. Provide a clear description of your changes and why they are needed.

## Reporting Bugs

Please use the [Bug Report Template](.github/ISSUE_TEMPLATE/bug_report.md) to report bugs. Include as much detail as possible, such as:

- Steps to reproduce the issue.
- Your operating system and Obsidian version.
- Any error logs from the console.

## License

By contributing, you agree that your contributions will be licensed under the project's [License](LICENSE).
