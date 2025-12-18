cmake_minimum_required(VERSION 3.10)
project(ncnn-ocr-wasm)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# ============================================ 
# 1. Fetch ncnn prebuilt binaries (Wasm)
# ============================================ 
include(FetchContent)

FetchContent_Declare(
  ncnn_prebuilt
  URL https://github.com/Tencent/ncnn/releases/download/20250916/ncnn-20250916-webassembly.zip
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)

FetchContent_MakeAvailable(ncnn_prebuilt)

# ============================================ 
# 2. Configure main project
# ============================================ 
set(NCNN_VARIANT "simd" CACHE STRING "NCNN Variant: basic, simd, threads, simd-threads")
message(STATUS "Building NCNN Variant: ${NCNN_VARIANT}")

if(NCNN_VARIANT STREQUAL "basic")
    # Basic Wasm (No SIMD, No Threads)
    set(ncnn_DIR "${ncnn_prebuilt_SOURCE_DIR}/basic/lib/cmake/ncnn")
    set(ARCH_FLAGS "")

elseif(NCNN_VARIANT STREQUAL "simd")
    # SIMD Wasm
    set(ncnn_DIR "${ncnn_prebuilt_SOURCE_DIR}/simd/lib/cmake/ncnn")
    set(ARCH_FLAGS "-msimd128")

elseif(NCNN_VARIANT STREQUAL "threads")
    # Threads Wasm
    set(ncnn_DIR "${ncnn_prebuilt_SOURCE_DIR}/threads/lib/cmake/ncnn")
    set(ARCH_FLAGS "-fopenmp" "-pthread")
    set(LINK_ARCH_FLAGS "-fopenmp" "-pthread" "-s" "USE_PTHREADS=1" "-s" "PTHREAD_POOL_SIZE=4")

elseif(NCNN_VARIANT STREQUAL "simd-threads")
    # SIMD + Threads Wasm
    set(ncnn_DIR "${ncnn_prebuilt_SOURCE_DIR}/simd-threads/lib/cmake/ncnn")
    set(ARCH_FLAGS "-msimd128" "-fopenmp" "-pthread")
    set(LINK_ARCH_FLAGS "-msimd128" "-fopenmp" "-pthread" "-s" "USE_PTHREADS=1" "-s" "PTHREAD_POOL_SIZE=4")

else()
    message(FATAL_ERROR "Unknown NCNN_VARIANT: ${NCNN_VARIANT}")
endif()

# Handle Threads Link Flags (if not set above)
if(NOT DEFINED LINK_ARCH_FLAGS)
    set(LINK_ARCH_FLAGS ${ARCH_FLAGS})
endif()

# ============================================ 
# 3. Build Type Configuration
# ============================================ 
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE "Release" CACHE STRING "Build type (Release, Debug, RelWithDebInfo)" FORCE)
endif()

message(STATUS "Build Type: ${CMAKE_BUILD_TYPE}")

if(CMAKE_BUILD_TYPE STREQUAL "Debug")
    # Debug: Slow, Safe, Verbose
    set(OPT_COMPILE_FLAGS "-O0" "-g")
    set(OPT_LINK_FLAGS "-O0" "-g" "-s" "ASSERTIONS=1" "-s" "STACK_OVERFLOW_CHECK=1")
    add_compile_definitions(DEBUG)

elseif(CMAKE_BUILD_TYPE STREQUAL "RelWithDebInfo")
    # Profiling / Performance Test: Fast, Verbose
    set(OPT_COMPILE_FLAGS "-O3" "-g")
    set(OPT_LINK_FLAGS "-O3" "-g" "--profiling")
    add_compile_definitions(DEBUG)

else()
    # Release: Fast, Silent
    set(OPT_COMPILE_FLAGS "-O3")
    set(OPT_LINK_FLAGS "-O3" "-flto")
    add_compile_definitions(NDEBUG)
endif()

# Combine Flags
set(OCR_COMPILE_OPTS ${ARCH_FLAGS} ${OPT_COMPILE_FLAGS})
set(OCR_LINK_OPTS ${LINK_ARCH_FLAGS} ${OPT_LINK_FLAGS})

# Explicitly set OpenMP flags for Emscripten detection
if(NCNN_VARIANT MATCHES "threads")
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -fopenmp")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -fopenmp")
    
    # Force OpenMP to be "found" to satisfy ncnnConfig.cmake dependency checks
    # Emscripten handles the actual linking via -fopenmp, so no specific lib names are needed.
    set(OpenMP_C_FLAGS "-fopenmp" CACHE STRING "Internal OpenMP C Flags")
    set(OpenMP_CXX_FLAGS "-fopenmp" CACHE STRING "Internal OpenMP CXX Flags")
    set(OpenMP_C_LIB_NAMES "" CACHE STRING "Internal OpenMP C Libs")
    set(OpenMP_CXX_LIB_NAMES "" CACHE STRING "Internal OpenMP CXX Libs")
    set(OpenMP_C_FOUND TRUE CACHE BOOL "Internal OpenMP C Found")
    set(OpenMP_CXX_FOUND TRUE CACHE BOOL "Internal OpenMP CXX Found")
    set(OpenMP_FOUND TRUE CACHE BOOL "Internal OpenMP Found")
endif()

find_package(ncnn REQUIRED)
add_compile_options(${OCR_COMPILE_OPTS})
include_directories(${CMAKE_CURRENT_SOURCE_DIR})

# Define source files
set(SOURCE_FILES
    main.cpp
    ocr_engine.cpp
)

add_executable(ocr-wasm ${SOURCE_FILES})

# Link ncnn
target_link_libraries(ocr-wasm PRIVATE ncnn)

# ============================================ 
# 3. Emscripten specific configuration
# ============================================ 
set_target_properties(ocr-wasm PROPERTIES LINK_FLAGS " \
    ${OCR_LINK_OPTS} \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s INITIAL_MEMORY=256MB \
    -s MAXIMUM_MEMORY=2048MB \
    -s FORCE_FILESYSTEM=1 \
    -s MODULARIZE=1 \
    -s EXPORT_NAME='createOcrModule' \
    -s EXPORTED_RUNTIME_METHODS=['ccall','cwrap','UTF8ToString','stringToUTF8','writeArrayToMemory','FS','HEAPU8'] \
    -s EXPORTED_FUNCTIONS=['_malloc','_free','_init_ocr_model','_detect','_warmup_model','_cleanup_vfs'] \
")

# ============================================ 
# 4. Test Target (for browser testing)
# ============================================ 
set(TEST_SRC "${CMAKE_CURRENT_SOURCE_DIR}/../../tests/src/test.cpp")
# Use absolute path for models to allow standard cmake behavior if needed, 
# but emscripten --preload-file works with relative paths from build dir usually.
# However, defining relative to Source Dir is safer.
set(MODELS_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../assets/models")

set(TEST_EXPORT_NAME "createTestModule" CACHE STRING "Export name for test module")

if(EXISTS "${TEST_SRC}")
    add_executable(test-wasm "${TEST_SRC}" ocr_engine.cpp)
    target_link_libraries(test-wasm PRIVATE ncnn)
    
    # Restore Preload for Test
    set_target_properties(test-wasm PROPERTIES LINK_FLAGS " \
        ${OCR_LINK_OPTS} \
        -s ALLOW_MEMORY_GROWTH=1 \
        -s INITIAL_MEMORY=256MB \
        -s MAXIMUM_MEMORY=2048MB \
        -s FORCE_FILESYSTEM=1 \
        -s MODULARIZE=1 \
        -s EXPORT_NAME='${TEST_EXPORT_NAME}' \
        --preload-file ${MODELS_DIR}@/models \
        -s EXPORTED_RUNTIME_METHODS=['ccall','cwrap','UTF8ToString','stringToUTF8','getValue','setValue','writeArrayToMemory','HEAPU8'] \
        -s EXPORTED_FUNCTIONS=['_malloc','_free','_init_ocr','_detect','_warmup_model','_cleanup_vfs'] \
        -s ENVIRONMENT=web \
    ")
endif()
