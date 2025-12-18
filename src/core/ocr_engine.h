#ifndef OCR_ENGINE_H
#define OCR_ENGINE_H

#include <cmath>
#include <string>
#include <vector>

#include "net.h"

// 自定义几何结构体，替代 OpenCV 类型
struct Point {
    float x;
    float y;
};

struct Size {
    float width;
    float height;
};

struct RotatedRect {
    Point center;
    Size size;
    float angle;

    void points(Point pts[]) const;
};

struct Character {
    int id;
    float prob;
};

struct Object {
    RotatedRect rrect;
    int orientation;
    float prob;
    std::vector<Character> text;
};

struct RecStats {
    double preprocess = 0.0;
    double inference = 0.0;
    double decode = 0.0;
};

class OCREngine {
public:
    OCREngine();
    ~OCREngine();

    void load_model(const char* det_param, const char* det_bin, const char* rec_param, const char* rec_bin);
    std::string detect(unsigned char* rgba_data, int width, int height);
    void warmup();
    void set_text_score_threshold(float threshold);

private:
    void detect_text(const unsigned char* rgba_data, int img_w, int img_h, std::vector<Object>& objects);
    void recognize_text(const unsigned char* rgba_data, int img_w, int img_h, Object& object, RecStats* stats = nullptr);
    ncnn::Mat crop_and_warp_roi(const unsigned char* rgba_data, int img_w, int img_h, const Object& object);

    float m_text_score_threshold = 0.5f;

    ncnn::Net ppocrv5_det;
    ncnn::Net ppocrv5_rec;
};

#endif // OCR_ENGINE_H
