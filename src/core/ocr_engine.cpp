#include "ocr_engine.h"

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <cstring>
#include <queue>
#include <sstream>

#include "log.h" // Include our custom logging header
#include "ppocrv5_dict.h"

// --- Profiling Macros (Active only in Debug/RelWithDebInfo) ---
#ifdef DEBUG
#include <chrono>
#define PROFILE_START(name) auto start_##name = std::chrono::high_resolution_clock::now()
#define PROFILE_END(name)                                                                                      \
    do {                                                                                                       \
        auto end_##name = std::chrono::high_resolution_clock::now();                                           \
        double duration_##name = std::chrono::duration<double, std::milli>(end_##name - start_##name).count(); \
        LOG_DEBUG("[Profile] " << #name << ": " << duration_##name << " ms");                                  \
    } while (0)

#define PROFILE_END_ACCUM(name, accum_ptr)                                                                     \
    do {                                                                                                       \
        auto end_##name = std::chrono::high_resolution_clock::now();                                           \
        double duration_##name = std::chrono::duration<double, std::milli>(end_##name - start_##name).count(); \
        if (accum_ptr)                                                                                         \
            *accum_ptr += duration_##name;                                                                     \
        else                                                                                                   \
            LOG_DEBUG("[Profile] " << #name << ": " << duration_##name << " ms");                              \
    } while (0)
#else
#define PROFILE_START(name)
#define PROFILE_END(name)
#define PROFILE_END_ACCUM(name, accum_ptr)
#endif

// Constants
const float PI = 3.1415926535f;
// const float TEXT_SCORE_THRESHOLD = 0.5f; // Removed in favor of member variable

// -------------------------------------------------------------------------
// Geometry & Math Helpers
// -------------------------------------------------------------------------

void RotatedRect::points(Point pts[]) const
{
    double angle_rad = angle * PI / 180.0;
    float cos_a = cos(angle_rad);
    float sin_a = sin(angle_rad);

    float hw = size.width / 2.0f;
    float hh = size.height / 2.0f;

    // Relative coordinates of corners (assuming 0 degrees is horizontal width)
    // BL, TL, TR, BR order to match typical OpenCV expectations if needed,
    // but here we just need 4 corners.
    // Let's iterate: (-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)
    // Corresponds to Top-Left, Top-Right, Bottom-Right, Bottom-Left in image
    // coords

    float cx_rel[] = { -hw, hw, hw, -hw };
    float cy_rel[] = { -hh, -hh, hh, hh };

    for (int i = 0; i < 4; i++) {
        // Rotate and translate
        // x' = x*cos - y*sin + cx
        // y' = x*sin + y*cos + cy
        pts[i].x = center.x + (cx_rel[i] * cos_a - cy_rel[i] * sin_a);
        pts[i].y = center.y + (cx_rel[i] * sin_a + cy_rel[i] * cos_a);
    }
}

// Simple Matrix for Affine Transform
struct Matrix2x3 {
    float m[6]; // m00, m01, m02, m10, m11, m12
};

static Matrix2x3 get_affine_transform(const Point src[], const Point dst[])
{
    // Solves for affine matrix mapping 3 src points to 3 dst points
    // Simplified version of OpenCV's getAffineTransform
    // We have 6 unknowns and 6 equations.
    // x' = a*x + b*y + c
    // y' = d*x + e*y + f

    // Uses Cramer's rule or elimination.
    // Given the specific use case (crop rotation), we can rely on standard math.

    float x1 = src[0].x, y1 = src[0].y, X1 = dst[0].x, Y1 = dst[0].y;
    float x2 = src[1].x, y2 = src[1].y, X2 = dst[1].x, Y2 = dst[1].y;
    float x3 = src[2].x, y3 = src[2].y, X3 = dst[2].x, Y3 = dst[2].y;

    float det = x1 * (y2 - y3) - y1 * (x2 - x3) + (x2 * y3 - x3 * y2);

    Matrix2x3 mat;
    if (std::abs(det) < 1e-6) {
        // Fallback identity
        mat.m[0] = 1;
        mat.m[1] = 0;
        mat.m[2] = 0;
        mat.m[3] = 0;
        mat.m[4] = 1;
        mat.m[5] = 0;
        return mat;
    }

    float inv_det = 1.0f / det;

    mat.m[0] = (X1 * (y2 - y3) - Y1 * (x2 - x3) + (X2 * y3 - X3 * y2) - (X3 * y2 - X3 * y2) /*simplify*/)
        * inv_det; // Wait, formula is complex.

    // Let's implement full Gaussian elimination for 3x3 system (finding a,b,c for
    // X, then d,e,f for Y) System 1: x1*a + y1*b + c = X1 x2*a + y2*b + c = X2
    // x3*a + y3*b + c = X3

    // Easier:
    float A = x1 * (y2 - y3) - y1 * (x2 - x3) + x2 * y3 - x3 * y2;

    mat.m[0] = (X1 * (y2 - y3) - y1 * (X2 - X3) + X2 * y3 - X3 * y2) / A;
    mat.m[1] = (x1 * (X2 - X3) - X1 * (x2 - x3) + x2 * X3 - x3 * X2) / A;
    mat.m[2] = (x1 * (y2 * X3 - y3 * X2) - y1 * (x2 * X3 - x3 * X2) + X1 * (x2 * y3 - x3 * y2)) / A;

    mat.m[3] = (Y1 * (y2 - y3) - y1 * (Y2 - Y3) + Y2 * y3 - Y3 * y2) / A;
    mat.m[4] = (x1 * (Y2 - Y3) - Y1 * (x2 - x3) + x2 * Y3 - x3 * Y2) / A;
    mat.m[5] = (x1 * (y2 * Y3 - y3 * Y2) - y1 * (x2 * Y3 - x3 * Y2) + Y1 * (x2 * y3 - x3 * y2)) / A;

    return mat;
}

static void warp_affine_bilinear(
    const ncnn::Mat& src, ncnn::Mat& dst, const Matrix2x3& M, int dst_w, int dst_h)
{
    dst.create(dst_w, dst_h, 3);

    // 计算逆矩阵
    double D = M.m[0] * M.m[4] - M.m[1] * M.m[3];
    if (std::abs(D) < 1e-6) return;

    double invD = 1.0 / D;
    double iM[6];
    iM[0] = M.m[4] * invD;
    iM[1] = -M.m[1] * invD;
    iM[2] = (M.m[1] * M.m[5] - M.m[2] * M.m[4]) * invD;
    iM[3] = -M.m[3] * invD;
    iM[4] = M.m[0] * invD;
    iM[5] = (M.m[2] * M.m[3] - M.m[0] * M.m[5]) * invD;

    const int src_w = src.w;
    const int src_h = src.h;

    // 预计算每行的起始坐标（行内变化是连续的）
    std::vector<float> row_start_x(dst_h);
    std::vector<float> row_start_y(dst_h);
    for (int dy = 0; dy < dst_h; dy++) {
        row_start_x[dy] = dy * iM[1] + iM[2];
        row_start_y[dy] = dy * iM[4] + iM[5];
    }

    // 按通道处理（更好的缓存局部性）
    for (int c = 0; c < 3; c++) {
        const float* src_ptr = src.channel(c);
        float* dst_ptr = dst.channel(c);

        for (int dy = 0; dy < dst_h; dy++) {
            float sx = row_start_x[dy];
            float sy = row_start_y[dy];

            // 行步进增量
            const float sx_step = iM[0];
            const float sy_step = iM[3];

            for (int dx = 0; dx < dst_w; dx++) {
                // 双线性插值
                int x0 = (int)sx;
                int y0 = (int)sy;

                // 边界检查（优化：使用位运算）
                if ((unsigned)x0 < (unsigned)(src_w - 1) && (unsigned)y0 < (unsigned)(src_h - 1)) {
                    // 在范围内，快速路径
                    float u = sx - x0;
                    float v = sy - y0;

                    const float* p = src_ptr + y0 * src_w + x0;
                    float v00 = p[0];
                    float v01 = p[1];
                    float v10 = p[src_w];
                    float v11 = p[src_w + 1];

                    float val = v00 * (1 - u) * (1 - v) + v01 * u * (1 - v) + v10 * (1 - u) * v + v11 * u * v;

                    dst_ptr[dy * dst_w + dx] = val;
                } else {
                    // 边界处理（使用clamp）
                    int x0_c = std::max(0, std::min(x0, src_w - 1));
                    int y0_c = std::max(0, std::min(y0, src_h - 1));
                    int x1_c = std::max(0, std::min(x0 + 1, src_w - 1));
                    int y1_c = std::max(0, std::min(y0 + 1, src_h - 1));

                    float u = sx - x0;
                    float v = sy - y0;

                    float v00 = src_ptr[y0_c * src_w + x0_c];
                    float v01 = src_ptr[y0_c * src_w + x1_c];
                    float v10 = src_ptr[y1_c * src_w + x0_c];
                    float v11 = src_ptr[y1_c * src_w + x1_c];

                    float val = v00 * (1 - u) * (1 - v) + v01 * u * (1 - v) + v10 * (1 - u) * v + v11 * u * v;

                    dst_ptr[dy * dst_w + dx] = val;
                }

                // 增量更新
                sx += sx_step;
                sy += sy_step;
            }
        }
    }
}

// -------------------------------------------------------------------------
// Contour & Box Helpers (Simplified)
// -------------------------------------------------------------------------

struct IntPoint {
    int x, y;
};

static void get_min_area_rect(const std::vector<IntPoint>& contour, RotatedRect& out_rect)
{
    if (contour.empty()) return;

    // PCA Approach
    double mean_x = 0, mean_y = 0;
    for (const auto& p : contour) {
        mean_x += p.x;
        mean_y += p.y;
    }
    mean_x /= contour.size();
    mean_y /= contour.size();

    double cov_xx = 0, cov_xy = 0, cov_yy = 0;
    for (const auto& p : contour) {
        double dx = p.x - mean_x;
        double dy = p.y - mean_y;
        cov_xx += dx * dx;
        cov_xy += dx * dy;
        cov_yy += dy * dy;
    }

    // Eigen decomposition of symmetric 2x2 matrix
    // [ a  b ]
    // [ b  c ]
    // lambda = ((a+c) +/- sqrt((a-c)^2 + 4b^2)) / 2
    double D = sqrt((cov_xx - cov_yy) * (cov_xx - cov_yy) + 4.0 * cov_xy * cov_xy);
    double lambda1 = (cov_xx + cov_yy + D) / 2.0;
    // double lambda2 = (cov_xx + cov_yy - D) / 2.0;

    // Eigen vector 1 (Main direction)
    double vx = 1.0, vy = 0.0;
    if (std::abs(cov_xy) > 1e-6) {
        vx = lambda1 - cov_yy;
        vy = cov_xy;
    } else {
        if (cov_xx >= cov_yy) {
            vx = 1.0;
            vy = 0.0;
        } else {
            vx = 0.0;
            vy = 1.0;
        }
    }
    double len = sqrt(vx * vx + vy * vy);
    vx /= len;
    vy /= len;

    // Project points to principal axes to find box
    // Axis 1: (vx, vy), Axis 2: (-vy, vx)
    double min_u = 1e9, max_u = -1e9;
    double min_v = 1e9, max_v = -1e9;

    for (const auto& p : contour) {
        double u = (p.x - mean_x) * vx + (p.y - mean_y) * vy;
        double v = (p.x - mean_x) * -vy + (p.y - mean_y) * vx;
        if (u < min_u) min_u = u;
        if (u > max_u) max_u = u;
        if (v < min_v) min_v = v;
        if (v > max_v) max_v = v;
    }

    // Box dimensions
    out_rect.size.width = (float)(max_u - min_u);
    out_rect.size.height = (float)(max_v - min_v);

    // Center in u,v space
    double center_u = (min_u + max_u) / 2.0;
    double center_v = (min_v + max_v) / 2.0;

    // Back to world coords
    out_rect.center.x = (float)(mean_x + center_u * vx - center_v * vy);
    out_rect.center.y = (float)(mean_y + center_u * vy + center_v * vx);

    // Angle
    // atan2(y, x) gives angle in radians. Convert to degrees.
    // OpenCV angle definition is bit tricky. It's usually angle of the "width"
    // side? Let's standardise: angle is rotation of the box 0..180 or -90..90.
    out_rect.angle = (float)(atan2(vy, vx) * 180.0 / PI);

    // Normalize angle / size to match typical expectations (width > height
    // usually for horizontal text) But PP-OCR handles this in logic later.
}

static double calculate_contour_score(const ncnn::Mat& pred_map, const std::vector<IntPoint>& contour, int w, int h)
{
    // bounding rect
    int min_x = w, max_x = 0, min_y = h, max_y = 0;
    for (const auto& p : contour) {
        if (p.x < min_x) min_x = p.x;
        if (p.x > max_x) max_x = p.x;
        if (p.y < min_y) min_y = p.y;
        if (p.y > max_y) max_y = p.y;
    }
    min_x = std::max(0, min_x);
    max_x = std::min(w - 1, max_x);
    min_y = std::max(0, min_y);
    max_y = std::min(h - 1, max_y);

    // Point-in-polygon test (Ray casting) to sum up scores
    double sum = 0;
    int count = 0;

    // Optimization: scanlines
    for (int y = min_y; y <= max_y; y++) {
        for (int x = min_x; x <= max_x; x++) {
            // Check if (x,y) inside contour
            bool inside = false;
            size_t n = contour.size();
            for (size_t i = 0, j = n - 1; i < n; j = i++) {
                if (((contour[i].y > y) != (contour[j].y > y))
                    && (x < (contour[j].x - contour[i].x) * (y - contour[i].y) / (double)(contour[j].y - contour[i].y)
                            + contour[i].x)) {
                    inside = !inside;
                }
            }

            if (inside) {
                sum += pred_map.row(y)[x];
                count++;
            }
        }
    }

    return count > 0 ? sum / count : 0.0;
}

// -------------------------------------------------------------------------
// OCREngine Implementation
// -------------------------------------------------------------------------

OCREngine::OCREngine() { }

OCREngine::~OCREngine()
{
    ppocrv5_det.clear();
    ppocrv5_rec.clear();
}

void OCREngine::load_model(const char* det_param, const char* det_bin, const char* rec_param, const char* rec_bin)
{
    ppocrv5_det.opt.use_vulkan_compute = false;
    ppocrv5_det.opt.use_fp16_packed = false;
    ppocrv5_det.opt.use_fp16_storage = false;
    ppocrv5_det.load_param(det_param);
    ppocrv5_det.load_model(det_bin);

    ppocrv5_rec.opt.use_vulkan_compute = false;
    ppocrv5_rec.opt.use_fp16_packed = false;
    ppocrv5_rec.opt.use_fp16_storage = false;
    ppocrv5_rec.load_param(rec_param);
    ppocrv5_rec.load_model(rec_bin);
}

void OCREngine::warmup()
{
    // 1. Warmup Detection
    // Create a dummy image (w=320, h=320, c=3)
    // Size should be aligned with typical inputs (divisible by 32)
    ncnn::Mat det_in(320, 320, 3);
    det_in.fill(1.f); // Fill to avoid uninitialized data

    ncnn::Extractor ex_det = ppocrv5_det.create_extractor();
    ex_det.input("in0", det_in);
    ncnn::Mat det_out;
    ex_det.extract("out0", det_out);

    // 2. Warmup Recognition
    // Rec model expects fixed height 48
    ncnn::Mat rec_in(160, 48, 3); // w=160, h=48, c=3
    rec_in.fill(0.5f);

    ncnn::Extractor ex_rec = ppocrv5_rec.create_extractor();
    ex_rec.input("in0", rec_in);
    ncnn::Mat rec_out;
    ex_rec.extract("out0", rec_out);

    LOG_INFO("[OCREngine] Warmup complete (Det + Rec run).");
}

void OCREngine::set_text_score_threshold(float threshold)
{
    m_text_score_threshold = threshold;
    LOG_INFO("[OCREngine] Text score threshold set to: " << threshold);
}

void OCREngine::detect_text(const unsigned char* rgba_data, int img_w, int img_h, std::vector<Object>& objects)
{
    PROFILE_START(Det_Preprocess);
    const int target_size = 960;
    const int target_stride = 32;

    int w = img_w;
    int h = img_h;
    float scale = 1.f;
    if (std::max(w, h) > target_size) {
        if (w > h) {
            scale = (float)target_size / w;
            w = target_size;
            h = h * scale;
        } else {
            scale = (float)target_size / h;
            h = target_size;
            w = w * scale;
        }
    }

    // Convert RGBA to BGR and resize in one step (like reference implementation)
    ncnn::Mat in = ncnn::Mat::from_pixels_resize(rgba_data, ncnn::Mat::PIXEL_RGBA2BGR, img_w, img_h, w, h);

    int wpad = (w + target_stride - 1) / target_stride * target_stride - w;
    int hpad = (h + target_stride - 1) / target_stride * target_stride - h;
    ncnn::Mat in_pad;
    ncnn::copy_make_border(
        in, in_pad, hpad / 2, hpad - hpad / 2, wpad / 2, wpad - wpad / 2, ncnn::BORDER_CONSTANT, 114.f);

    const float mean_vals[3] = { 0.485f * 255.f, 0.456f * 255.f, 0.406f * 255.f };
    const float norm_vals[3] = { 1 / 0.229f / 255.f, 1 / 0.224f / 255.f, 1 / 0.225f / 255.f };
    in_pad.substract_mean_normalize(mean_vals, norm_vals);
    PROFILE_END(Det_Preprocess);

    PROFILE_START(Det_Inference);
    ncnn::Extractor ex = ppocrv5_det.create_extractor();
    ex.input("in0", in_pad);
    ncnn::Mat out;
    ex.extract("out0", out);
    PROFILE_END(Det_Inference);

    PROFILE_START(Det_Postprocess);
    // CRITICAL: Denormalize output from [0,1] to [0,255]
    // PP-OCR detection model outputs probability map in range [0,1]
    // We need to scale it to [0,255] for proper thresholding
    const float denorm_vals[1] = { 255.f };
    out.substract_mean_normalize(0, denorm_vals);

    // Threshold to binary
    int out_w = out.w;
    int out_h = out.h;

    LOG_DEBUG("Detection map size: " << out_w << "x" << out_h);

    // Connected Component Analysis (BFS)
    // Create visited map
    std::vector<bool> visited(out_w * out_h, false);
    std::vector<std::vector<IntPoint>> contours;

    const float threshold = 0.3f * 255.f; // Scale threshold to match [0,255] range
    const float* pred_data = out.row(0); // Assuming channel 0

    // Debug: Check probability map statistics
    float max_prob = 0.0f;
    int above_threshold = 0;
    for (int i = 0; i < out_w * out_h; i++) {
        if (pred_data[i] > max_prob) max_prob = pred_data[i];
        if (pred_data[i] > threshold) above_threshold++;
    }
    LOG_DEBUG("Max probability: " << max_prob << ", Pixels above threshold: " << above_threshold);

    for (int y = 0; y < out_h; y++) {
        for (int x = 0; x < out_w; x++) {
            int idx = y * out_w + x;
            if (pred_data[idx] > threshold && !visited[idx]) {
                // New component
                std::vector<IntPoint> contour;
                std::queue<int> q;
                q.push(idx);
                visited[idx] = true;

                while (!q.empty()) {
                    int curr = q.front();
                    q.pop();
                    int cy = curr / out_w;
                    int cx = curr % out_w;

                    contour.push_back({ cx, cy });

                    // 4-neighbors
                    int nbs[4] = { curr - 1, curr + 1, curr - out_w, curr + out_w };
                    // Check bounds & valid
                    if (cx > 0) {
                        if (pred_data[curr - 1] > threshold && !visited[curr - 1]) {
                            visited[curr - 1] = true;
                            q.push(curr - 1);
                        }
                    }
                    if (cx < out_w - 1) {
                        if (pred_data[curr + 1] > threshold && !visited[curr + 1]) {
                            visited[curr + 1] = true;
                            q.push(curr + 1);
                        }
                    }
                    if (cy > 0) {
                        if (pred_data[curr - out_w] > threshold && !visited[curr - out_w]) {
                            visited[curr - out_w] = true;
                            q.push(curr - out_w);
                        }
                    }
                    if (cy < out_h - 1) {
                        if (pred_data[curr + out_w] > threshold && !visited[curr + out_w]) {
                            visited[curr + out_w] = true;
                            q.push(curr + out_w);
                        }
                    }
                }

                if (contour.size() > 5) { // Filter tiny noise
                    contours.push_back(contour);
                }
            }
        }
    }

    // Process Contours
    const float box_thresh = 0.6f;
    const float enlarge_ratio = 1.95f;
    const float min_size = 3 * scale;

    for (const auto& contour : contours) {
        // Score
        double score = calculate_contour_score(out, contour, out_w, out_h);
        score /= 255.0; // Normalize to [0, 1]

        if (score < box_thresh) continue;

        // Min Area Rect
        RotatedRect rrect;
        get_min_area_rect(contour, rrect);

        float rrect_maxwh = std::max(rrect.size.width, rrect.size.height);
        if (rrect_maxwh < min_size) continue;

        // Logic from original ppocrv5.cpp for orientation
        int orientation = 0;
        // rrect.angle is from PCA, which might be different from cv::minAreaRect.
        // Assuming get_min_area_rect provides angle in -90..90 or 0..180
        // We will stick to the logic from ppocrv5.cpp assuming similar angle
        // conventions. If our angle is purely direction of first eigenvector, it
        // might need adjustment.

        if (rrect.angle >= -30 && rrect.angle <= 30 && rrect.size.height > rrect.size.width * 2.7) {
            orientation = 1;
        }
        if ((rrect.angle <= -60 || rrect.angle >= 60) && rrect.size.width > rrect.size.height * 2.7) {
            orientation = 1;
        }

        if (rrect.angle < -30) {
            rrect.angle += 180;
        }

        if (orientation == 0 && rrect.angle < 30) {
            rrect.angle += 90;
            std::swap(rrect.size.width, rrect.size.height);
        }

        if (orientation == 1 && rrect.angle >= 60) {
            rrect.angle -= 90;
            std::swap(rrect.size.width, rrect.size.height);
        }

        // Enlarge
        rrect.size.height += rrect.size.width * (enlarge_ratio - 1);
        rrect.size.width *= enlarge_ratio;

        // Remap to original image
        rrect.center.x = (rrect.center.x - (wpad / 2.0f)) / scale;
        rrect.center.y = (rrect.center.y - (hpad / 2.0f)) / scale;
        rrect.size.width = rrect.size.width / scale;
        rrect.size.height = rrect.size.height / scale;

        // Validation: Check for degenerate boxes (extremely thin or small) that cause memory issues
        if (rrect.size.width < 1.0f || rrect.size.height < 1.0f) {
            LOG_WARN("Ignoring degenerate text box: " << rrect.size.width << "x" << rrect.size.height
                                                      << " at (" << rrect.center.x << "," << rrect.center.y << ")");
            continue;
        }

        // Check for extreme aspect ratios that might blow up the warping (e.g. ratio > 1:120)
        // In crop_and_warp, target_width = rh * 48 / rw. If rw is tiny compared to rh, width explodes.
        // If orientation=0 (horizontal), text is usually width > height.
        // If orientation=1 (vertical), text is usually height > width.
        // The warping logic depends on the specific un-rotated width/height logic in crop_and_warp.
        // Let's just safeguard against the specific division: ratio of H/W or W/H exceeding a limit.
        float ratio = rrect.size.height / (rrect.size.width + 1e-6f);
        if (ratio > 120.0f || ratio < (1.0f / 120.0f)) { // 1:120 or 120:1
            LOG_WARN("Ignoring extreme aspect ratio text box: " << rrect.size.width << "x" << rrect.size.height
                                                                << " (Ratio: " << ratio << ")");
            continue;
        }

        Object obj;
        obj.rrect = rrect;
        obj.orientation = orientation;
        obj.prob = score;
        objects.push_back(obj);
    }
    PROFILE_END(Det_Postprocess);
}

ncnn::Mat OCREngine::crop_and_warp_roi(const unsigned char* rgba_data, int img_w, int img_h, const Object& object)
{
    const int orientation = object.orientation;
    float rw = object.rrect.size.width;
    float rh = object.rrect.size.height;

    // Safety: Prevent division by zero or extremely thin boxes
    if (rw < 1.0f) rw = 1.0f;
    if (rh < 1.0f) rh = 1.0f;

    const int target_height = 48;
    // Safety check for extreme aspect ratios
    float target_width = rh * target_height / rw;

    // Cap max width to prevent memory explosion/OOB on weird artifacts
    const float max_target_width = 2048.0f;
    if (target_width > max_target_width) target_width = max_target_width;

    int final_w_int = (int)target_width;
    if (final_w_int < 16) final_w_int = 16;

    // Get corners
    Point corners[4];
    object.rrect.points(corners);

    // Calculate bounding box to crop minimal region
    float min_x = img_w, max_x = 0, min_y = img_h, max_y = 0;
    for (int i = 0; i < 4; i++) {
        if (corners[i].x < min_x) min_x = corners[i].x;
        if (corners[i].x > max_x) max_x = corners[i].x;
        if (corners[i].y < min_y) min_y = corners[i].y;
        if (corners[i].y > max_y) max_y = corners[i].y;
    }

    // Add margin and clamp
    const int margin = 10;
    int crop_x = std::max(0, (int)min_x - margin);
    int crop_y = std::max(0, (int)min_y - margin);
    int crop_w = std::min(img_w - crop_x, (int)(max_x - min_x) + 2 * margin);
    int crop_h = std::min(img_h - crop_y, (int)(max_y - min_y) + 2 * margin);

    // Manual crop: copy cropped RGBA region
    std::vector<unsigned char> cropped_rgba(crop_w * crop_h * 4);
    for (int y = 0; y < crop_h; y++) {
        const unsigned char* src_row = rgba_data + ((crop_y + y) * img_w + crop_x) * 4;
        unsigned char* dst_row = cropped_rgba.data() + y * crop_w * 4;
        memcpy(dst_row, src_row, crop_w * 4);
    }

    // Convert cropped region to BGR
    ncnn::Mat bgr_crop = ncnn::Mat::from_pixels(cropped_rgba.data(), ncnn::Mat::PIXEL_RGBA2BGR, crop_w, crop_h);

    // Adjust corners to cropped coordinate system
    Point src_pts[3];
    if (orientation == 0) {
        src_pts[0] = { corners[3].x - crop_x, corners[3].y - crop_y }; // TL
        src_pts[1] = { corners[0].x - crop_x, corners[0].y - crop_y }; // TR
        src_pts[2] = { corners[2].x - crop_x, corners[2].y - crop_y }; // BL
    } else {
        src_pts[0] = { corners[1].x - crop_x, corners[1].y - crop_y }; // TR
        src_pts[1] = { corners[2].x - crop_x, corners[2].y - crop_y }; // BR
        src_pts[2] = { corners[0].x - crop_x, corners[0].y - crop_y }; // TL
    }

    Point dst_pts[3];
    dst_pts[0] = { 0, 0 };
    dst_pts[1] = { (float)final_w_int, 0 };
    dst_pts[2] = { 0, (float)target_height };

    Matrix2x3 M = get_affine_transform(src_pts, dst_pts);

    ncnn::Mat roi_planar;
    warp_affine_bilinear(bgr_crop, roi_planar, M, final_w_int, target_height);

    return roi_planar;
}

void OCREngine::recognize_text(const unsigned char* rgba_data, int img_w, int img_h, Object& object, RecStats* stats)
{
    PROFILE_START(Rec_Preprocess);
    // Crop and warp ROI
    ncnn::Mat roi_planar = crop_and_warp_roi(rgba_data, img_w, img_h, object);

    // Normalization
    const float mean_vals[3] = { 127.5f, 127.5f, 127.5f };
    const float norm_vals[3] = { 1.0f / 127.5f, 1.0f / 127.5f, 1.0f / 127.5f };
    roi_planar.substract_mean_normalize(mean_vals, norm_vals);
    PROFILE_END_ACCUM(Rec_Preprocess, (stats ? &stats->preprocess : nullptr));

    PROFILE_START(Rec_Inference);
    ncnn::Extractor ex = ppocrv5_rec.create_extractor();
    ex.input("in0", roi_planar);
    ncnn::Mat out;
    ex.extract("out0", out);
    PROFILE_END_ACCUM(Rec_Inference, (stats ? &stats->inference : nullptr));

    PROFILE_START(Rec_Decode);
    // Decode (CTC Greedy) with Merge
    int last_token = 0;
    for (int i = 0; i < out.h; i++) {
        const float* p = out.row(i);
        int index = 0;
        float max_score = -9999.f;
        for (int j = 0; j < out.w; j++) {
            float score = *p++;
            if (score > max_score) {
                max_score = score;
                index = j;
            }
        }

        if (last_token == index) continue; // CTC Merge
        last_token = index;

        if (index <= 0) continue; // Blank token

        Character ch;
        ch.id = index - 1;
        ch.prob = max_score;
        object.text.push_back(ch);
    }
    PROFILE_END_ACCUM(Rec_Decode, (stats ? &stats->decode : nullptr));
}

std::string OCREngine::detect(unsigned char* rgba_data, int width, int height)
{
    PROFILE_START(Total_Pipeline);
    if (width <= 0 || height <= 0 || !rgba_data) return "{}";

    LOG_DEBUG("Input: " << width << "x" << height << " RGBA");

    std::vector<Object> objects;
    detect_text(rgba_data, width, height, objects);
    LOG_DEBUG("Detection found " << objects.size() << " text regions");

    // Recognize each text box (no full-image BGR allocation)
    // NCNN's light mode (enabled by default) automatically recycles intermediate
    // blobs
    PROFILE_START(Rec_Loop_Total);

    RecStats rec_stats; // Accumulator for recognition steps

    for (size_t i = 0; i < objects.size(); i++) {
        recognize_text(rgba_data, width, height, objects[i], &rec_stats);

        // Calculate average text confidence
        float sum_prob = 0.f;
        int count = 0;
        for (const auto& ch : objects[i].text) {
            sum_prob += ch.prob;
            count++;
        }
        // If text was recognized, update obj.prob to be the recognition confidence.
        // Otherwise, keep the detection confidence.
        if (count > 0) {
            objects[i].prob = sum_prob / count;
        }
    }
    PROFILE_END(Rec_Loop_Total);

    LOG_DEBUG("[Profile] Rec_Preprocess (Total): " << rec_stats.preprocess << " ms");
    LOG_DEBUG("[Profile] Rec_Inference  (Total): " << rec_stats.inference << " ms");
    LOG_DEBUG("[Profile] Rec_Decode     (Total): " << rec_stats.decode << " ms");

    // JSON Build
    std::stringstream ss;
    ss << "[";
    bool first = true;
    for (size_t i = 0; i < objects.size(); ++i) {
        const Object& obj = objects[i];
        if (obj.prob < m_text_score_threshold) continue;

        if (!first) ss << ",";
        ss << "{";
        first = false;

        Point corners[4];
        obj.rrect.points(corners);
        ss << "\"box\":[";
        for (int k = 0; k < 4; ++k) {
            if (k > 0) ss << ",";
            ss << "[" << corners[k].x << "," << corners[k].y << "]";
        }
        ss << "],";

        ss << "\"text\":\"";
        std::string text_str = "";
        for (const auto& ch : obj.text) {
            if (ch.id < character_dict_size) {
                text_str += character_dict[ch.id];
            }
        }

        for (char c : text_str) {
            if (c == '"')
                ss << "\\\"";
            else if (c == '\\')
                ss << "\\\\";
            else if (c == '\n')
                ss << "\\n";
            else if (c == '\r')
                ss << "\\r";
            else if (c == '\t')
                ss << "\\t";
            else
                ss << c;
        }
        ss << "\",";
        ss << "\"prob\":" << obj.prob;
        ss << "}";
    }
    ss << "]";

    PROFILE_END(Total_Pipeline);
    return ss.str();
}
