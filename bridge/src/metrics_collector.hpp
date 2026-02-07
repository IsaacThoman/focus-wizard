/**
 * metrics_collector.hpp — Extracts structured data from SmartSpectra callbacks
 *
 * SmartSpectra gives us two types of metrics:
 *   1. Core metrics (MetricsBuffer) — from the Physiology REST API, includes
 *      refined pulse rate, breathing rate, HRV, etc.
 *   2. Edge metrics (Metrics) — computed per-frame on-device, includes
 *      myofacial analysis (gaze, blinks, face points, talking).
 *
 * This collector turns both into JSON strings for the emitter.
 */

#pragma once

#include <string>
#include <cstdint>

// SmartSpectra / Physiology headers
#include <physiology/modules/messages/metrics.h>

namespace focus_wizard {

/**
 * Snapshot of all metrics we care about for focus detection.
 * Updated incrementally as callbacks fire.
 */
struct FocusMetrics {
    // ── Cardiac ──────────────────────────────────────────
    float pulse_rate_bpm       = 0.0f;
    float pulse_confidence     = 0.0f;   // from MeasurementWithConfidence
    bool  has_pulse             = false;

    // ── Breathing ────────────────────────────────────────
    float breathing_rate_bpm   = 0.0f;
    float breathing_confidence = 0.0f;
    bool  has_breathing         = false;

    // ── Myofacial (Edge & Core) ──────────────────────────
    bool  face_detected         = false;
    bool  is_blinking           = false;
    bool  is_talking            = false;
    float blink_rate_per_min    = 0.0f;  // rolling estimate (computed locally)

    // ── Gaze Estimation (from face landmarks) ────────────
    float gaze_x                = 0.0f;  // Horizontal: -1.0 (left) to +1.0 (right)
    float gaze_y                = 0.0f;  // Vertical: -1.0 (up) to +1.0 (down)
    bool  has_gaze              = false;

    // ── Timestamp ────────────────────────────────────────
    int64_t timestamp_us        = 0;
};

class MetricsCollector {
public:
    /**
     * Process core metrics from Physiology REST API callback.
     * Returns a JSON string representing the update.
     */
    std::string process_core_metrics(
        const presage::physiology::MetricsBuffer& metrics,
        int64_t timestamp_us
    );

    /**
     * Process edge metrics computed on-device.
     * Returns a JSON string representing the update.
     */
    std::string process_edge_metrics(
        const presage::physiology::Metrics& metrics
    );

    /**
     * Get the current aggregated focus metrics snapshot.
     */
    const FocusMetrics& current() const { return current_metrics_; }

private:
    FocusMetrics current_metrics_;
};

} // namespace focus_wizard
