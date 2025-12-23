import createOcrModule, { OcrModule } from 'ocr-wasm-engine';
import ocrWasmBinary from 'ocr-wasm-engine/binary';

interface OcrResultItem {
  box: [[number, number], [number, number], [number, number], [number, number]];
  text: string;
  prob: number;
}

// Type definitions for messages (Simplified)
export type WorkerMessage =
  | { type: 'init'; payload: { models: Record<string, Uint8Array> } }
  | {
      type: 'detect';
      payload: { width: number; height: number; buffer: Uint8Array };
      id: number;
    }
  | { type: 'set-threshold'; payload: { threshold: number } };

export type WorkerResponse =
  | { type: 'init-success' }
  | { type: 'init-error'; error: string }
  | { type: 'detect-success'; id: number; results: OcrResultItem[] }
  | { type: 'detect-error'; id: number; error: string }
  | { type: 'set-threshold-success' };

let ocrModule: OcrModule | null = null;
let isInitialized = false;

// Helper to interact with VFS
function writeToVFS(path: string, data: Uint8Array) {
  if (!ocrModule) return;
  try {
    ocrModule.FS.writeFile(path, data);
  } catch (e) {
    console.error('Worker VFS Write Error:', e);
    throw e;
  }
}

function allocString(str: string): number {
  if (!ocrModule) return 0;
  const len = str.length * 4 + 1;
  const ptr = ocrModule._malloc(len);
  ocrModule.stringToUTF8(str, ptr, len);
  return ptr;
}

// Main Message Handler
self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;

  try {
    if (msg.type === 'init') {
      if (isInitialized) {
        self.postMessage({ type: 'init-success' });
        return;
      }

      console.debug('[Worker] Initializing Wasm...');

      ocrModule = await createOcrModule({
        wasmBinary: ocrWasmBinary,
        print: (text: string) => console.debug('[Worker Wasm]: ' + text),
        printErr: (text: string) => console.error('[Worker Wasm Err]: ' + text),
      });

      const models = msg.payload.models;

      // Create /models directory
      try {
        ocrModule.FS.mkdir('/models');
      } catch (_e) {
        // Directory might already exist
      }

      // Write model files
      writeToVFS('/models/PP_OCRv5_mobile_det.ncnn.param', models['detParam']);
      writeToVFS('/models/PP_OCRv5_mobile_det.ncnn.bin', models['detBin']);
      writeToVFS('/models/PP_OCRv5_mobile_rec.ncnn.param', models['recParam']);
      writeToVFS('/models/PP_OCRv5_mobile_rec.ncnn.bin', models['recBin']);

      // Init C++ Engine
      const p1 = allocString('/models/PP_OCRv5_mobile_det.ncnn.param');
      const p2 = allocString('/models/PP_OCRv5_mobile_det.ncnn.bin');
      const p3 = allocString('/models/PP_OCRv5_mobile_rec.ncnn.param');
      const p4 = allocString('/models/PP_OCRv5_mobile_rec.ncnn.bin');

      try {
        const res = ocrModule._init_ocr_model(p1, p2, p3, p4);
        if (res !== 0) throw new Error(`Init failed with code ${res}`);
      } finally {
        ocrModule._free(p1);
        ocrModule._free(p2);
        ocrModule._free(p3);
        ocrModule._free(p4);
      }

      ocrModule._warmup_model();

      isInitialized = true;
      console.debug('[Worker] Init complete.');
      self.postMessage({ type: 'init-success' });
    } else if (msg.type === 'detect') {
      if (!ocrModule || !isInitialized)
        throw new Error('Worker not initialized');

      const { width, height, buffer } = msg.payload;
      const numBytes = width * height * 4;

      const ptr = ocrModule._malloc(numBytes);
      try {
        if (ocrModule.HEAPU8) {
          ocrModule.HEAPU8.set(buffer, ptr);
        } else {
          ocrModule.writeArrayToMemory(buffer, ptr);
        }

        const resPtr = ocrModule._detect(ptr, width, height);
        const jsonStr = ocrModule.UTF8ToString(resPtr);
        const results = JSON.parse(jsonStr);

        self.postMessage({ type: 'detect-success', id: msg.id, results });
      } finally {
        ocrModule._free(ptr);
      }
    } else if (msg.type === 'set-threshold') {
      if (!ocrModule || !isInitialized)
        throw new Error('Worker not initialized');
      ocrModule._set_text_score_threshold(msg.payload.threshold);
      self.postMessage({ type: 'set-threshold-success' });
    }
  } catch (err) {
    console.error('[Worker Error]', err);
    const errorMsg = err instanceof Error ? err.message : String(err);
    
    if (msg.type === 'init') {
        self.postMessage({ type: 'init-error', error: errorMsg });
    } else if (msg.type === 'detect') {
        self.postMessage({ type: 'detect-error', id: msg.id, error: errorMsg });
    }
  }
};