###########################################################
# Focus Wizard — C++ Presage SmartSpectra Bridge
#
# This builds a headless CLI that captures webcam frames,
# runs them through SmartSpectra, and emits JSON metrics
# to stdout for the Electron app to consume.
###########################################################

cmake_minimum_required(VERSION 3.27.0)
project(FocusBridge CXX)

# ── C++ Standard ──────────────────────────────────────────
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# ── Find Dependencies ─────────────────────────────────────
# SmartSpectra SDK (installed via PPA or from-source build)
find_package(SmartSpectra REQUIRED)

# OpenCV (usually comes with SmartSpectra, but explicit is better)
find_package(OpenCV REQUIRED)

# ── Bridge Sources ────────────────────────────────────────
set(BRIDGE_SOURCES
    src/main.cpp
    src/json_emitter.cpp
    src/metrics_collector.cpp
    src/focus_analyzer.cpp
)

set(BRIDGE_HEADERS
    src/json_emitter.hpp
    src/metrics_collector.hpp
    src/focus_analyzer.hpp
)

# ── Build Target ──────────────────────────────────────────
add_executable(focus_bridge ${BRIDGE_SOURCES} ${BRIDGE_HEADERS})

target_include_directories(focus_bridge PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

target_link_libraries(focus_bridge
    # Required: SmartSpectra container (includes video capture, MediaPipe graph, etc.)
    SmartSpectra::Container
    # Optional: OpenCV HUD components (we run headless but need OpenCV types)
    SmartSpectra::Gui
    # OpenCV
    ${OpenCV_LIBS}
)

# ── Install ───────────────────────────────────────────────
install(TARGETS focus_bridge DESTINATION bin)
