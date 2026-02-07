/**
 * main.cpp — Focus Wizard Bridge
 *
 * Headless SmartSpectra runner with two modes:
 *
 *   LOCAL mode (default):
 *     Captures webcam directly on this machine via SmartSpectra SDK.
 *     Use when running on the same machine as the Electron app (Ubuntu).
 *
 *   SERVER mode (--mode=server --file_stream_path=...):
 *     Reads frames from a directory (SmartSpectra file_stream input).
 *     A WebSocket server writes incoming webcam frames as numbered PNGs;
 *     SmartSpectra picks them up and processes them. Use when the Electron
 *     app is on Mac/Windows and this bridge runs on an Ubuntu server.
 *
 * Both modes emit JSON lines to stdout.
 *
 * Usage:
 *   # Local mode (Ubuntu desktop with webcam)
 *   ./focus_bridge --api_key=YOUR_KEY
 *
 *   # Server mode (Ubuntu server, frames written by WS relay)
 *   ./focus_bridge --api_key=YOUR_KEY --mode=server \
 *       --file_stream_path=/tmp/focus_frames/frame0000000000000000.png
 *
 * The process runs until it receives SIGTERM/SIGINT or the parent
 * process closes the pipe.
 */

// ── Standard Library ─────────────────────────────────────
#include <string>
#include <iostream>
#include <csignal>
#include <cstdlib>
#include <memory>

// ── Third-party ──────────────────────────────────────────
#include <absl/status/status.h>
#include <absl/flags/flag.h>
#include <absl/flags/parse.h>
#include <absl/flags/usage.h>
#include <glog/logging.h>

// ── SmartSpectra SDK ─────────────────────────────────────
#include <smartspectra/container/settings.hpp>
#include <smartspectra/container/foreground_container.hpp>
#include <smartspectra/video_source/camera/camera.hpp>
#include <physiology/modules/messages/metrics.h>
#include <physiology/modules/messages/status.h>

// ── Focus Wizard ─────────────────────────────────────────
#include "json_emitter.hpp"
#include "metrics_collector.hpp"
#include "focus_analyzer.hpp"

// ── Aliases ──────────────────────────────────────────────
namespace pcam     = presage::camera;
namespace spectra  = presage::smartspectra;
namespace settings = presage::smartspectra::container::settings;
namespace vs       = presage::smartspectra::video_source;
namespace container = presage::smartspectra::container;

// ── Command-line Flags ───────────────────────────────────
ABSL_FLAG(std::string, api_key, "",
    "Presage Physiology API key. Can also be set via SMARTSPECTRA_API_KEY env var.");
ABSL_FLAG(std::string, mode, "local",
    "Operating mode: 'local' (capture webcam directly) or 'server' (read frames from directory).");

// -- Local mode flags --
ABSL_FLAG(int, camera_device_index, 0,
    "Index of the camera device to use (0 = default webcam). Local mode only.");
ABSL_FLAG(int, capture_width, 1280,
    "Capture width in pixels. Local mode only.");
ABSL_FLAG(int, capture_height, 720,
    "Capture height in pixels. Local mode only.");

// -- Server mode flags --
ABSL_FLAG(std::string, file_stream_path, "",
    "Path pattern for frame files, e.g. '/tmp/focus_frames/frame0000000000000000.png'. "
    "The zero padding defines digit count; the number encodes the timestamp in microseconds. "
    "Server mode only.");
ABSL_FLAG(int, rescan_delay_ms, 5,
    "Delay in ms before re-scanning the frame directory for new files. Server mode only.");
ABSL_FLAG(bool, erase_read_files, true,
    "Erase frame files after they've been read. Server mode only.");

// -- Focus analysis thresholds (both modes) --
ABSL_FLAG(float, blink_threshold, 25.0f,
    "Blink rate threshold (blinks/min) for drowsiness detection.");
ABSL_FLAG(float, pulse_threshold, 100.0f,
    "Pulse rate threshold (BPM) for stress detection.");
ABSL_FLAG(float, breathing_threshold, 22.0f,
    "Breathing rate threshold (breaths/min) for stress detection.");

// ── Globals ──────────────────────────────────────────────
static focus_wizard::JsonEmitter g_emitter;
static volatile std::sig_atomic_t g_shutdown_requested = 0;

void signal_handler(int signal) {
    g_shutdown_requested = 1;
}

// ── Resolve API Key ──────────────────────────────────────
std::string resolve_api_key() {
    std::string key = absl::GetFlag(FLAGS_api_key);
    if (!key.empty()) return key;

    const char* env_key = std::getenv("SMARTSPECTRA_API_KEY");
    if (env_key && env_key[0] != '\0') return std::string(env_key);

    return "";
}

// ── Main ─────────────────────────────────────────────────
int main(int argc, char** argv) {
    // Setup logging — send to stderr so stdout stays clean for JSON
    google::InitGoogleLogging(argv[0]);
    FLAGS_logtostderr = true;     // All glog output → stderr
    FLAGS_alsologtostderr = false;

    absl::SetProgramUsageMessage(
        "Focus Wizard Bridge — headless SmartSpectra runner.\n"
        "Two modes: 'local' (captures webcam) or 'server' (reads frame files).\n\n"
        "Local:  focus_bridge --api_key=KEY\n"
        "Server: focus_bridge --api_key=KEY --mode=server "
        "--file_stream_path=/tmp/focus_frames/frame0000000000000000.png"
    );
    absl::ParseCommandLine(argc, argv);

    // Handle signals for graceful shutdown
    std::signal(SIGINT, signal_handler);
    std::signal(SIGTERM, signal_handler);

    // Resolve API key
    std::string api_key = resolve_api_key();
    if (api_key.empty()) {
        g_emitter.emit_error("No API key provided. Use --api_key=KEY or set SMARTSPECTRA_API_KEY");
        return 1;
    }

    // Determine mode
    std::string mode = absl::GetFlag(FLAGS_mode);
    bool server_mode = (mode == "server");

    if (server_mode) {
        std::string fsp = absl::GetFlag(FLAGS_file_stream_path);
        if (fsp.empty()) {
            g_emitter.emit_error("Server mode requires --file_stream_path. "
                "Example: --file_stream_path=/tmp/focus_frames/frame0000000000000000.png");
            return 1;
        }
        g_emitter.emit_status("Starting in SERVER mode (reading frames from directory)...");
    } else {
        g_emitter.emit_status("Starting in LOCAL mode (capturing webcam)...");
    }

    try {
        // ── Configure SmartSpectra ───────────────────────
        settings::Settings<
            settings::OperationMode::Continuous,
            settings::IntegrationMode::Rest
        > ss_settings;

        if (server_mode) {
            // ── Server mode: read frames from file_stream directory ──
            // The WS relay server writes frames as numbered PNGs to this dir.
            // SmartSpectra's FileStreamVideoSource picks them up automatically.
            ss_settings.video_source.file_stream_path     = absl::GetFlag(FLAGS_file_stream_path);
            ss_settings.video_source.rescan_retry_delay_ms = absl::GetFlag(FLAGS_rescan_delay_ms);
            ss_settings.video_source.erase_read_files     = absl::GetFlag(FLAGS_erase_read_files);
            // Leave input_video_path empty so factory picks file_stream
            ss_settings.video_source.input_video_path     = "";
            ss_settings.video_source.input_video_time_path = "";
        } else {
            // ── Local mode: capture from webcam directly ─────────────
            ss_settings.video_source.device_index      = absl::GetFlag(FLAGS_camera_device_index);
            ss_settings.video_source.capture_width_px  = absl::GetFlag(FLAGS_capture_width);
            ss_settings.video_source.capture_height_px = absl::GetFlag(FLAGS_capture_height);
            ss_settings.video_source.codec             = pcam::CaptureCodec::MJPG;
            ss_settings.video_source.auto_lock         = true;
            ss_settings.video_source.input_video_path      = "";
            ss_settings.video_source.input_video_time_path = "";
        }

        // Run headless — no OpenCV GUI windows
        ss_settings.headless = true;

        // Start recording immediately (no GUI → no user press "s")
        // Without this the REST sync pipeline never receives data and
        // the UsageSyncCalculator times out.
        ss_settings.start_with_recording_on = true;

        // We want edge metrics for myofacial analysis (gaze, blinks, etc.)
        ss_settings.enable_edge_metrics = true;

        // Enable dense face mesh (468 landmarks) for gaze estimation
        ss_settings.enable_dense_facemesh_points = true;

        ss_settings.verbosity_level = 1; // moderate — helps debug startup issues

        // Continuous mode: buffer duration (seconds).
        // 0.2 matches Android SDK default; shorter = more frequent API updates.
        ss_settings.continuous.preprocessed_data_buffer_duration_s = 0.2;

        // API key for REST integration
        ss_settings.integration.api_key = api_key;

        // ── Create Container ─────────────────────────────
        auto ss_container = std::make_unique<
            container::CpuContinuousRestForegroundContainer
        >(ss_settings);

        // ── Setup Focus Analysis Pipeline ────────────────
        focus_wizard::MetricsCollector collector;
        focus_wizard::FocusThresholds thresholds;
        thresholds.blink_rate_drowsy_threshold = absl::GetFlag(FLAGS_blink_threshold);
        thresholds.pulse_stressed_threshold    = absl::GetFlag(FLAGS_pulse_threshold);
        thresholds.breathing_stressed_threshold = absl::GetFlag(FLAGS_breathing_threshold);
        focus_wizard::FocusAnalyzer analyzer(thresholds);

        // ── Core Metrics Callback ────────────────────────
        // Fires when the Physiology REST API returns refined metrics
        // (pulse rate, breathing rate, HRV, etc.)
        auto core_status = ss_container->SetOnCoreMetricsOutput(
            [&collector, &analyzer](
                const presage::physiology::MetricsBuffer& metrics,
                int64_t timestamp
            ) {
                // Extract metrics
                std::string metrics_json = collector.process_core_metrics(metrics, timestamp);
                g_emitter.emit("metrics", metrics_json);

                // Run focus analysis on updated state
                std::string focus_json = analyzer.analyze(collector.current());
                g_emitter.emit("focus", focus_json);

                return absl::OkStatus();
            }
        );
        if (!core_status.ok()) {
            g_emitter.emit_error("Failed to set core metrics callback: " +
                                 std::string(core_status.message()));
            return 1;
        }

        // ── Edge Metrics Callback ────────────────────────
        // Fires per-frame with on-device computed data
        // (face landmarks, blinks, talking, etc.)
        auto edge_status = ss_container->SetOnEdgeMetricsOutput(
            [&collector, &analyzer](
                const presage::physiology::Metrics& metrics,
                int64_t timestamp
            ) {
                // Extract edge metrics
                std::string edge_json = collector.process_edge_metrics(metrics);
                g_emitter.emit("edge", edge_json);

                // Run focus analysis on updated state
                std::string focus_json = analyzer.analyze(collector.current());
                g_emitter.emit("focus", focus_json);

                return absl::OkStatus();
            }
        );
        if (!edge_status.ok()) {
            g_emitter.emit_error("Failed to set edge metrics callback: " +
                                 std::string(edge_status.message()));
            return 1;
        }

        // ── Video Output Callback (headless) ─────────────
        // We don't display anything, but we need to handle the callback
        // to keep the pipeline flowing. We also check for shutdown here.
        auto video_status = ss_container->SetOnVideoOutput(
            [](cv::Mat& frame, int64_t timestamp) {
                if (g_shutdown_requested) {
                    return absl::CancelledError("Shutdown requested");
                }
                // In headless mode, we just let the frame pass through.
                // Could optionally do frame analysis here (ambient light, etc.)
                return absl::OkStatus();
            }
        );
        if (!video_status.ok()) {
            g_emitter.emit_error("Failed to set video callback: " +
                                 std::string(video_status.message()));
            return 1;
        }

        // ── Status Change Callback ───────────────────────
        auto status_cb_status = ss_container->SetOnStatusChange(
            [](presage::physiology::StatusValue imaging_status) {
                std::string desc = presage::physiology::GetStatusDescription(
                    imaging_status.value()
                );
                g_emitter.emit_status(desc);
                return absl::OkStatus();
            }
        );
        if (!status_cb_status.ok()) {
            g_emitter.emit_error("Failed to set status callback: " +
                                 std::string(status_cb_status.message()));
            return 1;
        }

        // ── Initialize ──────────────────────────────────
        g_emitter.emit_status("Opening camera and initializing pipeline...");
        if (auto init_status = ss_container->Initialize(); !init_status.ok()) {
            g_emitter.emit_error("Failed to initialize: " +
                                 std::string(init_status.message()));
            return 1;
        }

        // ── Signal Ready ────────────────────────────────
        g_emitter.emit_ready();

        // ── Run (blocks until cancelled or error) ───────
        if (auto run_status = ss_container->Run(); !run_status.ok()) {
            // CancelledError is expected on graceful shutdown
            if (run_status.code() != absl::StatusCode::kCancelled) {
                g_emitter.emit_error("Processing failed: " +
                                     std::string(run_status.message()));
                return 1;
            }
        }

        g_emitter.emit_status("Shutting down...");
        return 0;

    } catch (const std::exception& e) {
        g_emitter.emit_error(std::string("Fatal error: ") + e.what());
        return 1;
    }
}
