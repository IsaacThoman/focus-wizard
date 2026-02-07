/**
 * focus_analyzer.hpp — Derives a "focus state" from raw metrics
 *
 * Takes the raw physiological signals and produces a high-level focus
 * assessment that the Electron UI can consume directly.
 *
 * Focus states:
 *   FOCUSED     — user is looking at screen, vitals are calm, engaged
 *   DISTRACTED  — (reserved for future gaze/iris tracking)
 *   DROWSY      — high blink rate, slowing breathing
 *   STRESSED    — elevated pulse, fast breathing
 *   AWAY        — no face detected (user left desk)
 *   TALKING     — user is on a call / talking to someone
 *   UNKNOWN     — insufficient data to determine state
 */

#pragma once

#include "metrics_collector.hpp"
#include <string>
#include <chrono>

namespace focus_wizard {

enum class FocusState {
    FOCUSED,
    DISTRACTED,
    DROWSY,
    STRESSED,
    AWAY,
    TALKING,
    UNKNOWN
};

/**
 * Convert FocusState enum to a string for JSON output.
 */
const char* focus_state_to_string(FocusState state);

/**
 * Configurable thresholds for focus analysis.
 * These can be tuned based on user feedback.
 */
struct FocusThresholds {
    // Blink rate: normal is 15-20/min; above this suggests drowsiness
    float blink_rate_drowsy_threshold = 25.0f;

    // Pulse: resting is 60-100 BPM; elevated suggests stress
    float pulse_stressed_threshold = 100.0f;

    // Breathing: normal is 12-20/min; elevated suggests stress/anxiety
    float breathing_stressed_threshold = 22.0f;

    // Gaze: deviation magnitude above which user is distracted
    float gaze_distraction_threshold = 0.3f;

    // How many seconds without face before marking AWAY
    float face_absence_timeout_s = 3.0f;
};

class FocusAnalyzer {
public:
    explicit FocusAnalyzer(FocusThresholds thresholds = {});

    /**
     * Analyze current metrics and return the focus state + a JSON payload.
     */
    std::string analyze(const FocusMetrics& metrics);

    /**
     * Get the current determined focus state.
     */
    FocusState current_state() const { return current_state_; }

private:
    FocusThresholds thresholds_;
    FocusState current_state_ = FocusState::UNKNOWN;

    // Track face absence duration
    std::chrono::steady_clock::time_point last_face_seen_;
    bool ever_seen_face_ = false;

    /**
     * Build the JSON output for the current analysis.
     */
    std::string build_json(FocusState state, float focus_score, const FocusMetrics& metrics);
};

} // namespace focus_wizard
