/**
 * metrics_collector.cpp — Implementation
 *
 * Extracts the specific fields from SmartSpectra protobuf structures
 * that are relevant to focus detection.
 *
 * SDK API reference (protobuf-generated classes):
 *   MetricsBuffer: pulse(), breathing(), blood_pressure(), face(), metadata()
 *   Metrics (edge): breathing(), micromotion(), eda(), face()
 *   Pulse: rate(), trace(), pulse_respiration_quotient(), strict()
 *   Face: blinking(), talking(), landmarks()
 *   DetectionStatus: time(), detected(), stable(), timestamp()
 *   MeasurementWithConfidence: time(), value(), stable(), confidence(), timestamp()
 */

#include "metrics_collector.hpp"

#include <sstream>
#include <iomanip>
#include <chrono>
#include <deque>

namespace focus_wizard {

// ── Blink rate estimator ─────────────────────────────────
// We track blink event timestamps and compute blinks-per-minute
// from a sliding 60-second window.
static std::deque<std::chrono::steady_clock::time_point> blink_timestamps;
static bool prev_blink_state = false;

static float estimate_blink_rate(bool currently_blinking) {
    auto now = std::chrono::steady_clock::now();

    // Detect rising edge (transition from not-blinking to blinking)
    if (currently_blinking && !prev_blink_state) {
        blink_timestamps.push_back(now);
    }
    prev_blink_state = currently_blinking;

    // Evict entries older than 60 seconds
    auto cutoff = now - std::chrono::seconds(60);
    while (!blink_timestamps.empty() && blink_timestamps.front() < cutoff) {
        blink_timestamps.pop_front();
    }

    // Convert count-in-window to blinks-per-minute
    return static_cast<float>(blink_timestamps.size());
}

std::string MetricsCollector::process_core_metrics(
    const presage::physiology::MetricsBuffer& metrics,
    int64_t timestamp_us
) {
    current_metrics_.timestamp_us = timestamp_us;

    // ── Pulse Rate ───────────────────────────────────────
    if (metrics.has_pulse() && !metrics.pulse().rate().empty()) {
        const auto& latest = *metrics.pulse().rate().rbegin();
        current_metrics_.pulse_rate_bpm = latest.value();
        current_metrics_.pulse_confidence = latest.confidence();
        current_metrics_.has_pulse = true;
    }

    // ── Breathing Rate ───────────────────────────────────
    if (metrics.has_breathing() && !metrics.breathing().rate().empty()) {
        const auto& latest = *metrics.breathing().rate().rbegin();
        current_metrics_.breathing_rate_bpm = latest.value();
        current_metrics_.breathing_confidence = latest.confidence();
        current_metrics_.has_breathing = true;
    }

    // ── Face data from core (blinking, talking, landmarks) ──
    if (metrics.has_face()) {
        current_metrics_.face_detected = true;

        if (!metrics.face().blinking().empty()) {
            current_metrics_.is_blinking = metrics.face().blinking().rbegin()->detected();
            current_metrics_.blink_rate_per_min = estimate_blink_rate(current_metrics_.is_blinking);
        }

        if (!metrics.face().talking().empty()) {
            current_metrics_.is_talking = metrics.face().talking().rbegin()->detected();
        }
    }

    // ── Build JSON ───────────────────────────────────────
    std::ostringstream json;
    json << std::fixed << std::setprecision(2);
    json << "{";
    json << "\"timestamp_us\":" << timestamp_us;
    json << ",\"pulse_rate_bpm\":" << current_metrics_.pulse_rate_bpm;
    json << ",\"has_pulse\":" << (current_metrics_.has_pulse ? "true" : "false");
    json << ",\"pulse_confidence\":" << current_metrics_.pulse_confidence;
    json << ",\"breathing_rate_bpm\":" << current_metrics_.breathing_rate_bpm;
    json << ",\"has_breathing\":" << (current_metrics_.has_breathing ? "true" : "false");
    json << "}";

    return json.str();
}

std::string MetricsCollector::process_edge_metrics(
    const presage::physiology::Metrics& metrics
) {
    // ── Face Detection ─────────────────────────────────
    if (metrics.has_face()) {
        current_metrics_.face_detected = true;

        // ── Blink Detection ──────────────────────────────
        if (!metrics.face().blinking().empty()) {
            current_metrics_.is_blinking = metrics.face().blinking().rbegin()->detected();
            current_metrics_.blink_rate_per_min = estimate_blink_rate(current_metrics_.is_blinking);
        }

        // ── Talking Detection ────────────────────────────
        if (!metrics.face().talking().empty()) {
            current_metrics_.is_talking = metrics.face().talking().rbegin()->detected();
        }

        // ── Gaze Estimation from Face Landmarks ──────────
        // Uses MediaPipe face mesh: nose tip relative to face
        // bounding box center as a proxy for head orientation.
        if (!metrics.face().landmarks().empty()) {
            const auto& latest_lm = *metrics.face().landmarks().rbegin();
            int lm_count = latest_lm.value_size();

            // Need 468 landmarks (full MediaPipe face mesh)
            if (lm_count >= 468) {
                const auto& nose_tip    = latest_lm.value(4);    // Nose tip
                const auto& left_cheek  = latest_lm.value(234);  // Left face boundary
                const auto& right_cheek = latest_lm.value(454);  // Right face boundary
                const auto& forehead    = latest_lm.value(10);   // Forehead center
                const auto& chin        = latest_lm.value(152);  // Chin

                float face_center_x = (left_cheek.x() + right_cheek.x()) / 2.0f;
                float face_center_y = (forehead.y() + chin.y()) / 2.0f;
                float face_width  = right_cheek.x() - left_cheek.x();
                float face_height = chin.y() - forehead.y();

                if (face_width > 1.0f && face_height > 1.0f) {
                    current_metrics_.gaze_x = (nose_tip.x() - face_center_x) / (face_width / 2.0f);
                    current_metrics_.gaze_y = (nose_tip.y() - face_center_y) / (face_height / 2.0f);
                    current_metrics_.has_gaze = true;
                }
            }
        }
    } else {
        current_metrics_.face_detected = false;
        current_metrics_.has_gaze = false;
    }

    // ── Build JSON ───────────────────────────────────────
    std::ostringstream json;
    json << std::fixed << std::setprecision(4);
    json << "{";
    json << "\"face_detected\":" << (current_metrics_.face_detected ? "true" : "false");
    json << ",\"is_blinking\":" << (current_metrics_.is_blinking ? "true" : "false");
    json << ",\"blink_rate_per_min\":" << current_metrics_.blink_rate_per_min;
    json << ",\"is_talking\":" << (current_metrics_.is_talking ? "true" : "false");
    json << ",\"gaze_x\":" << current_metrics_.gaze_x;
    json << ",\"gaze_y\":" << current_metrics_.gaze_y;
    json << ",\"has_gaze\":" << (current_metrics_.has_gaze ? "true" : "false");
    json << "}";

    return json.str();
}

} // namespace focus_wizard
