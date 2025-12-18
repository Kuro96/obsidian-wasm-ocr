#pragma once

#include <cstring> // For strrchr
#include <iostream> // For std::cout, std::cerr, std::endl
#include <sstream> // For std::stringstream
#include <string> // For std::string

// Macro to get filename only from __FILE__
#ifdef _WIN32
#define __FILENAME__ (strrchr(__FILE__, '\\') ? strrchr(__FILE__, '\\') + 1 : __FILE__)
#else
#define __FILENAME__ (strrchr(__FILE__, '/') ? strrchr(__FILE__, '/') + 1 : __FILE__)
#endif

// --- Debug Logging ---
// Enable LOG_DEBUG only if DEBUG is explicitly defined.
// This allows RelWithDebInfo to have debug logs (by defining DEBUG)
// even if NDEBUG is set by standard CMake rules.
#if defined(DEBUG)
#define LOG_DEBUG(msg)                                                                         \
    do {                                                                                       \
        std::cout << "[DEBUG] " << __FILENAME__ << ":" << __LINE__ << " " << msg << std::endl; \
    } while (0)
#else
#define LOG_DEBUG(msg) \
    do {               \
    } while (0)
#endif

// --- Info Logging (usually enabled in both debug and release) ---
#define LOG_INFO(msg)                               \
    do {                                            \
        std::cout << "[INFO] " << msg << std::endl; \
    } while (0)

// --- Warning Logging ---
#define LOG_WARN(msg)                               \
    do {                                            \
        std::cout << "[WARN] " << msg << std::endl; \
    } while (0)

// --- Error Logging (always enabled) ---
#define LOG_ERROR(msg)                                                                         \
    do {                                                                                       \
        std::cerr << "[ERROR] " << __FILENAME__ << ":" << __LINE__ << " " << msg << std::endl; \
    } while (0)
