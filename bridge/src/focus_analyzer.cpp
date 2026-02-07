/**
 * focus_analyzer.cpp — Implementation
 *
 * Priority-based state determination:
 *   1. AWAY (no face) — highest priority, nothing to analyze
 *   2. TALKING — user is speaking, might be on a call
 *   3. DROWSY — high blink rate, physiological indicators
 *   4. STRESSED — elevated vitals
 *   5. DISTRACTED — excessive blinking / restless behaviour
 *   6. FOCUSED — everything looks good
 *   7. UNKNOWN — not enough data yet
 */

#include "focus_analyzer.hpp"

#include <cmath>
#include <sstream>
#include <iomanip>
#include <algorithm>
#include <numeric>

namespace focus_wizard {

const char* focus_state_to_string(FocusState state) {
    switch (state) {
        case FocusState::FOCUSED:    return "focused";
        case FocusState::DISTRACTED: return "distracted";
        case FocusState::DROWSY:     return "drowsy";
        case FocusState::STRESSED:   return "stressed";
        case FocusState::AWAY:       return "away";
        case FocusState::TALKING:    return "talking";
        case FocusState::UNKNOWN:    return "unknown";
        default:                     return "unknown";
    }
}

FocusAnalyzer::FocusAnalyzer(FocusThresholds thresholds)
    : thresholds_(thresholds)
    , last_face_seen_(std::chrono::steady_clock::now())
{
}

std::string FocusAnalyzer::analyze(const FocusMetrics& metrics) {
    auto now = std::chrono::steady_clock::now();

    // ── Track face presence ──────────────────────────────
    if (metrics.face_detected) {
        last_face_seen_ = now;
        ever_seen_face_ = true;
    }

    // ── Determine state (priority order) ─────────────────

    FocusState state = FocusState::UNKNOWN;
    float focus_score = 0.5f; // 0.0 = totally unfocused, 1.0 = fully focused

    // 1. Check if face is gone (AWAY)
    if (ever_seen_face_) {
        auto absence_duration = std::chrono::duration_cast<std::chrono::milliseconds>(
            now - last_face_seen_
        ).count() / 1000.0f;

        if (!metrics.face_detected && absence_duration > thresholds_.face_absence_timeout_s) {
            state = FocusState::AWAY;
            focus_score = 0.0f;
        }
    }

    // Only analyze further if we have a face
    bool can_analyze = metrics.face_detected;

    if (state == FocusState::UNKNOWN && can_analyze) {
        // 2. Check talking
        if (metrics.is_talking) {
            state = FocusState::TALKING;
            focus_score = 0.3f; // Talking isn't necessarily unfocused, but it's a distraction
        }

        // 3. Check distraction (gaze looking away from screen)
        if (state == FocusState::UNKNOWN && metrics.has_gaze) {
            float gaze_mag = std::sqrt(
                metrics.gaze_x * metrics.gaze_x +
                metrics.gaze_y * metrics.gaze_y
            );
            if (gaze_mag > thresholds_.gaze_distraction_threshold) {
                state = FocusState::DISTRACTED;
                focus_score = std::max(0.1f, 0.6f - gaze_mag * 0.3f);
            }
        }

        // 4. Check drowsy indicators
        if (state == FocusState::UNKNOWN) {
            bool high_blink_rate = metrics.blink_rate_per_min > thresholds_.blink_rate_drowsy_threshold;
            bool slow_breathing = metrics.has_breathing &&
                                  metrics.breathing_rate_bpm < 12.0f; // unusually slow

            if (high_blink_rate || (high_blink_rate && slow_breathing)) {
                state = FocusState::DROWSY;
                focus_score = 0.15f;
            }
        }

        // 5. Check stress indicators
        if (state == FocusState::UNKNOWN) {
            bool elevated_pulse = metrics.has_pulse &&
                                  metrics.pulse_rate_bpm > thresholds_.pulse_stressed_threshold;
            bool fast_breathing = metrics.has_breathing &&
                                  metrics.breathing_rate_bpm > thresholds_.breathing_stressed_threshold;

            // Need at least one strong signal, or both moderate
            if (elevated_pulse && fast_breathing) {
                state = FocusState::STRESSED;
                focus_score = 0.25f;
            }
        }

        // 6. If nothing triggered, user is focused!
        if (state == FocusState::UNKNOWN && ever_seen_face_) {
            state = FocusState::FOCUSED;
            // Score based on physiological calm
            float vitals_score = 1.0f;
            if (metrics.has_pulse && metrics.pulse_rate_bpm > 0) {
                // Penalize slightly if pulse is elevated (but not enough for STRESSED)
                vitals_score = std::min(1.0f,
                    thresholds_.pulse_stressed_threshold / metrics.pulse_rate_bpm);
            }
            focus_score = vitals_score;
        }
    }

    // If we still don't know (no face ever seen, etc.)
    if (state == FocusState::UNKNOWN) {
        focus_score = 0.5f; // neutral
    }

    current_state_ = state;
    return build_json(state, focus_score, metrics);
}

std::string FocusAnalyzer::build_json(
    FocusState state,
    float focus_score,
    const FocusMetrics& metrics
) {
    std::ostringstream json;
    json << std::fixed << std::setprecision(3);
    json << "{";
    json << "\"state\":\"" << focus_state_to_string(state) << "\"";
    json << ",\"focus_score\":" << focus_score;
    json << ",\"face_detected\":" << (metrics.face_detected ? "true" : "false");
    json << ",\"is_talking\":" << (metrics.is_talking ? "true" : "false");
    json << ",\"is_blinking\":" << (metrics.is_blinking ? "true" : "false");
    json << ",\"blink_rate_per_min\":" << metrics.blink_rate_per_min;
    json << ",\"gaze_x\":" << metrics.gaze_x;
    json << ",\"gaze_y\":" << metrics.gaze_y;
    json << ",\"has_gaze\":" << (metrics.has_gaze ? "true" : "false");
    json << ",\"pulse_bpm\":" << metrics.pulse_rate_bpm;
    json << ",\"breathing_bpm\":" << metrics.breathing_rate_bpm;
    json << "}";
    return json.str();
}

} // namespace focus_wizard
