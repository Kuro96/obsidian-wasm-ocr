declare module 'ocr-wasm-engine' {
  export interface OcrModule extends EmscriptenModule {
    _init_ocr_model(
      det_param: number,
      det_bin: number,
      rec_param: number,
      rec_bin: number,
    ): number;
    _detect(ptr: number, width: number, height: number): number;
    _set_text_score_threshold(threshold: number): void;
    _warmup_model(): void;
    _cleanup_vfs(
      det_param: number,
      det_bin: number,
      rec_param: number,
      rec_bin: number,
    ): void;
    _malloc(size: number): number;
    _free(ptr: number): void;

    // Emscripten runtime
    UTF8ToString(ptr: number): string;
    stringToUTF8(str: string, outPtr: number, maxBytesToWrite: number): void;
    writeArrayToMemory(
      array: Uint8Array | Uint8ClampedArray,
      buffer: number,
    ): void;
    HEAPU8: Uint8Array;
    FS: {
      writeFile(
        path: string,
        data: Uint8Array | ArrayBufferView,
        opts?: Record<string, unknown>,
      ): void;
      mkdir(path: string, mode?: number): void;
    };
  }

  const createOcrModule: (moduleOverrides?: Record<string, unknown>) => Promise<OcrModule>;
  export default createOcrModule;
}

declare module 'ocr-wasm-engine/binary' {
  const wasmBinary: Uint8Array;
  export default wasmBinary;
}
