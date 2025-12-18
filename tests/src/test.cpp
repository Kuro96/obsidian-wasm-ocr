#include "../../src/core/log.h"
#include "../../src/core/ocr_engine.h"
#include <emscripten.h>
#include <iostream>
#include <string>
#include <unistd.h> // for unlink
#include <vector>

// Global engine instance
static OCREngine* g_ocr = nullptr;

extern "C" {

// Initialize (Paths)
EMSCRIPTEN_KEEPALIVE
int init_ocr()
{
    if (g_ocr) delete g_ocr;
    g_ocr = new OCREngine();

    // Paths in Wasm VFS
    const char* det_param = "/models/PP_OCRv5_mobile_det.ncnn.param";
    const char* det_bin = "/models/PP_OCRv5_mobile_det.ncnn.bin";
    const char* rec_param = "/models/PP_OCRv5_mobile_rec.ncnn.param";
    const char* rec_bin = "/models/PP_OCRv5_mobile_rec.ncnn.bin";

    g_ocr->load_model(det_param, det_bin, rec_param, rec_bin);
    LOG_INFO("OCR Model initialized from VFS.");
    return 0;
}

// Detect Wrapper
EMSCRIPTEN_KEEPALIVE
const char* detect(unsigned char* rgba_data, int width, int height)
{
    if (!g_ocr) {
        return "{\"error\": \"Model not initialized\"}";
    }

    std::string json_result = g_ocr->detect(rgba_data, width, height);

    static std::string ret_cache;
    ret_cache = json_result;
    return ret_cache.c_str();
}

// Warmup
EMSCRIPTEN_KEEPALIVE
void warmup_model()
{
    if (g_ocr) g_ocr->warmup();
}

// Cleanup VFS (release memory after model loaded)
EMSCRIPTEN_KEEPALIVE
void cleanup_vfs()
{
    const char* files[] = {
        "/models/PP_OCRv5_mobile_det.ncnn.param",
        "/models/PP_OCRv5_mobile_det.ncnn.bin",
        "/models/PP_OCRv5_mobile_rec.ncnn.param",
        "/models/PP_OCRv5_mobile_rec.ncnn.bin"
    };

    LOG_INFO("Cleaning up VFS...");
    for (const char* file : files) {
        if (unlink(file) == 0) {
            std::string msg = "Deleted: " + std::string(file);
            LOG_INFO(msg);
        }
    }
    LOG_INFO("VFS cleanup complete.");
}
}

int main()
{
    return 0;
}
