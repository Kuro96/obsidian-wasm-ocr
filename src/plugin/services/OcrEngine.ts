import { App, Notice, requestUrl } from 'obsidian';
// @ts-ignore
import workerCode from 'worker:ocr';

const GITHUB_ORG = 'Kuro96';
const GITHUB_REPO = 'obsidian-wasm-ocr';

export interface OcrResultItem {
  box: [[number, number], [number, number], [number, number], [number, number]];
  text: string;
  prob: number;
}

export class OcrEngine {
  private app: App;
  private manifestDir: string;
  private worker: Worker | null = null;
  private isInitializing = false;
  private initPromise: Promise<void> | null = null;

  // Pending requests map: requestId -> { resolve, reject }
  private pendingRequests = new Map<
    number,
    { resolve: (res: any) => void; reject: (err: any) => void }
  >();
  private nextRequestId = 1;

  constructor(app: App, manifestDir: string) {
    this.app = app;
    this.manifestDir = manifestDir;
  }

  async init() {
    if (this.worker) return;
    if (this.initPromise) return this.initPromise;

    this.isInitializing = true;
    this.initPromise = new Promise(async (resolve, reject) => {
      try {
        console.log('[OcrEngine] Starting Worker...');
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        this.worker = new Worker(url);

        // Setup Listener
        this.worker.onmessage = (e) => {
          const msg = e.data;
          if (msg.type === 'init-success') {
            console.log('[OcrEngine] Worker Init Success');
            resolve();
          } else if (msg.type === 'init-error') {
            console.error('[OcrEngine] Worker Init Error:', msg.error);
            reject(new Error(msg.error));
          } else if (msg.type === 'detect-success') {
            const req = this.pendingRequests.get(msg.id);
            if (req) {
              req.resolve(msg.results);
              this.pendingRequests.delete(msg.id);
            }
          } else if (msg.type === 'detect-error') {
            const req = this.pendingRequests.get(msg.id);
            if (req) {
              req.reject(new Error(msg.error));
              this.pendingRequests.delete(msg.id);
            }
          }
        };

        this.worker.onerror = (err) => {
          console.error('[OcrEngine] Worker Error:', err);
          reject(err);
        };

        // Ensure models are available
        const modelDir = this.manifestDir + '/models';
        const adapter = this.app.vault.adapter;

        const modelsToLoad = {
          detParam: 'PP_OCRv5_mobile_det.ncnn.param',
          detBin: 'PP_OCRv5_mobile_det.ncnn.bin',
          recParam: 'PP_OCRv5_mobile_rec.ncnn.param',
          recBin: 'PP_OCRv5_mobile_rec.ncnn.bin',
        };

        // Check if models exist
        if (!(await this.checkModels())) {
          throw new Error(
            'OCR Models not found. Please download them in Plugin Settings.',
          );
        }

        // Load Models
        console.log('[OcrEngine] Loading models...');

        const loadedModels: Record<string, Uint8Array> = {};

        for (const [key, filename] of Object.entries(modelsToLoad)) {
          const path = `${modelDir}/${filename}`;
          if (await adapter.exists(path)) {
            const buf = await adapter.readBinary(path);
            loadedModels[key] = new Uint8Array(buf);
          } else {
            throw new Error(`Model file missing: ${path}`);
          }
        }

        // Send Init Message with Transfers
        // We need to collect buffers to transfer ownership
        const buffers = Object.values(loadedModels).map((arr) => arr.buffer);

        this.worker.postMessage(
          {
            type: 'init',
            payload: { models: loadedModels },
          },
          buffers,
        ); // Transfer buffers!
      } catch (e) {
        console.error(e);
        this.worker = null;
        reject(e);
      } finally {
        this.isInitializing = false;
      }
    });

    return this.initPromise;
  }

  async checkModels(): Promise<boolean> {
    const modelDir = this.manifestDir + '/models';
    const adapter = this.app.vault.adapter;
    const files = [
      'PP_OCRv5_mobile_det.ncnn.param',
      'PP_OCRv5_mobile_det.ncnn.bin',
      'PP_OCRv5_mobile_rec.ncnn.param',
      'PP_OCRv5_mobile_rec.ncnn.bin',
    ];

    for (const f of files) {
      if (!(await adapter.exists(`${modelDir}/${f}`))) return false;
    }
    return true;
  }

  async downloadModels(onProgress?: (msg: string) => void) {
    const targetDir = this.manifestDir + '/models';
    const filenames = [
      'PP_OCRv5_mobile_det.ncnn.param',
      'PP_OCRv5_mobile_det.ncnn.bin',
      'PP_OCRv5_mobile_rec.ncnn.param',
      'PP_OCRv5_mobile_rec.ncnn.bin',
    ];

    if (onProgress) onProgress('Starting download...');
    const adapter = this.app.vault.adapter;

    if (!(await adapter.exists(targetDir))) {
      await adapter.mkdir(targetDir);
    }

    // Use 'latest' release to avoid hardcoding version
    const baseUrl = `https://github.com/${GITHUB_ORG}/${GITHUB_REPO}/releases/latest/download`;

    for (const filename of filenames) {
      const url = `${baseUrl}/${filename}`;
      try {
        if (onProgress) onProgress(`Downloading ${filename}...`);
        // using requestUrl from Obsidian API to avoid CORS issues in some contexts
        const response = await requestUrl({ url, method: 'GET' });

        if (response.status !== 200) {
          throw new Error(
            `Failed to download ${url}. Status: ${response.status}`,
          );
        }

        await adapter.writeBinary(
          `${targetDir}/${filename}`,
          response.arrayBuffer,
        );
      } catch (error) {
        console.error(`Failed to download ${filename}`, error);
        throw error;
      }
    }
    if (onProgress) onProgress('Download complete!');
  }

  async detect(imageData: ImageData): Promise<OcrResultItem[]> {
    await this.init();
    if (!this.worker) throw new Error('Worker failed to start');

    return new Promise((resolve, reject) => {
      const id = this.nextRequestId++;
      this.pendingRequests.set(id, { resolve, reject });

      // Copy to ensure we have a clean buffer to transfer
      // NCNN expects RGBA.
      const buffer = new Uint8Array(imageData.data);

      this.worker!.postMessage(
        {
          type: 'detect',
          id,
          payload: {
            width: imageData.width,
            height: imageData.height,
            buffer: buffer,
          },
        },
        [buffer.buffer],
      ); // Transfer!
    });
  }

  async setThreshold(threshold: number): Promise<void> {
    await this.init();
    if (!this.worker) return;

    this.worker.postMessage({
      type: 'set-threshold',
      payload: { threshold },
    });
  }

  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
