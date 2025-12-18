#include <emscripten.h>
#include <unistd.h> // for access()

#include <string>

#include "log.h" // Include our custom logging header
#include "ocr_engine.h"

// Global engine instance
static OCREngine* g_ocr = nullptr;

extern "C" {

// Initialize with Model Paths (VFS)
EMSCRIPTEN_KEEPALIVE
int init_ocr_model(const char* det_param, const char* det_bin, const char* rec_param, const char* rec_bin)
{
    if (g_ocr) delete g_ocr;
    g_ocr = new OCREngine();

    LOG_INFO("[Core] Initializing with paths:");
    LOG_INFO("  Det Param: " << det_param);
    LOG_INFO("  Det Bin: " << det_bin);

    if (access(det_param, F_OK) != 0) {
        LOG_ERROR("Model file not found: " << det_param);
        return -1;
    }

    g_ocr->load_model(det_param, det_bin, rec_param, rec_bin);
    LOG_INFO("OCR Model initialized successfully.");
    return 0;
}

// Set Threshold
EMSCRIPTEN_KEEPALIVE
void set_text_score_threshold(float threshold)
{
    if (g_ocr) {
        g_ocr->set_text_score_threshold(threshold);
    }
}

// Inference
EMSCRIPTEN_KEEPALIVE
const char* detect(unsigned char* rgba_data, int width, int height)
{
    if (!g_ocr) {
        return "{\"error\": \"OCR engine not initialized. Call init_ocr_model() "
               "first.\"}";
    }

    // Call C++ core logic
    std::string json_result = g_ocr->detect(rgba_data, width, height);

    // Return result
    static std::string ret_cache;
    ret_cache = json_result;
    return ret_cache.c_str();
}

// Warmup (Dummy Forward)
EMSCRIPTEN_KEEPALIVE
void warmup_model()
{
    if (!g_ocr) return;
    g_ocr->warmup();
}

// Cleanup VFS to free memory
EMSCRIPTEN_KEEPALIVE
void cleanup_vfs(const char* det_param, const char* det_bin, const char* rec_param, const char* rec_bin)
{
    LOG_INFO("[Core] Cleaning up VFS...");

    // Delete model files from VFS
    // unlink() returns 0 on success, -1 on error
    if (unlink(det_param) == 0) {
        LOG_INFO("  Deleted: " << det_param);
    }
    if (unlink(det_bin) == 0) {
        LOG_INFO("  Deleted: " << det_bin);
    }
    if (unlink(rec_param) == 0) {
        LOG_INFO("  Deleted: " << rec_param);
    }
    if (unlink(rec_bin) == 0) {
        LOG_INFO("  Deleted: " << rec_bin);
    }

    LOG_INFO("[Core] VFS cleanup complete.");
}
}
