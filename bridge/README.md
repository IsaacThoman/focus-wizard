# Focus Wizard — C++ Bridge

This is the C++ component that interfaces with the
[Presage SmartSpectra SDK](https://github.com/Presage-Security/SmartSpectra) to
capture webcam data and produce real-time physiological metrics.

## How It Works

The bridge runs as a **headless child process** spawned by the Electron app. It:

1. Opens the webcam via SmartSpectra's built-in OpenCV camera capture
2. Runs continuous physiological analysis (pulse, breathing, myofacial)
3. Derives a focus state (focused, distracted, drowsy, stressed, away, talking)
4. Emits **JSON Lines** to stdout (one JSON object per `\n`)

The Electron main process reads these lines and forwards them to the React UI
via IPC.

## JSON Protocol

Each line is a complete JSON object with a `type` field:

```jsonl
{"type":"status","data":{"status":"Initializing SmartSpectra..."}}
{"type":"ready","data":{}}
{"type":"edge","data":{"face_detected":true,"is_blinking":false,"gaze_x":0.12,"gaze_y":-0.05,...}}
{"type":"metrics","data":{"pulse_rate_bpm":72.50,"breathing_rate_bpm":16.20,...}}
{"type":"focus","data":{"state":"focused","focus_score":0.85,"face_detected":true,...}}
{"type":"error","data":{"message":"Camera not found"}}
```

### Message Types

| Type      | Description                                         | Frequency                    |
| --------- | --------------------------------------------------- | ---------------------------- |
| `status`  | Human-readable status updates                       | On state changes             |
| `ready`   | Bridge is initialized and running                   | Once                         |
| `edge`    | Per-frame edge metrics (gaze, blinks, face)         | ~30 fps                      |
| `metrics` | Core metrics from Physiology API (pulse, breathing) | Every few seconds            |
| `focus`   | Derived focus state + score                         | On every edge/metrics update |
| `error`   | Error messages                                      | As needed                    |

## Building

### Prerequisites

**Ubuntu 22.04 / Linux Mint 21:**

```bash
# Install SmartSpectra SDK
curl -s "https://presage-security.github.io/PPA/KEY.gpg" | gpg --dearmor | sudo tee /etc/apt/trusted.gpg.d/presage-technologies.gpg >/dev/null
sudo curl -s --compressed -o /etc/apt/sources.list.d/presage-technologies.list "https://presage-security.github.io/PPA/presage-technologies.list"
sudo apt update
sudo apt install libsmartspectra-dev

# Install build tools
sudo apt install build-essential cmake libopencv-dev
```

**macOS (from-source SmartSpectra build):**

```bash
# You'll need to build SmartSpectra from source — see their repo for instructions
# Then set CMAKE_PREFIX_PATH to point to your build
brew install cmake opencv
```

### Build

```bash
mkdir build && cd build
cmake ..
make -j$(nproc)
```

### Run Standalone

```bash
# With API key as flag
./focus_bridge --api_key=YOUR_KEY

# With environment variable
export SMARTSPECTRA_API_KEY=YOUR_KEY
./focus_bridge

# With custom camera
./focus_bridge --api_key=YOUR_KEY --camera_device_index=1

# With custom thresholds
./focus_bridge --api_key=YOUR_KEY \
  --gaze_threshold=0.4 \
  --blink_threshold=20 \
  --pulse_threshold=90
```

## Architecture

```
main.cpp
  │
  ├── SmartSpectra Container (headless, continuous, REST)
  │     │
  │     ├── OnCoreMetricsOutput callback
  │     │     └── MetricsCollector::process_core_metrics()
  │     │           └── FocusAnalyzer::analyze()
  │     │                 └── JsonEmitter::emit("focus", ...)
  │     │
  │     ├── OnEdgeMetricsOutput callback
  │     │     └── MetricsCollector::process_edge_metrics()
  │     │           └── FocusAnalyzer::analyze()
  │     │                 └── JsonEmitter::emit("focus", ...)
  │     │
  │     ├── OnVideoOutput callback
  │     │     └── (headless — just checks for shutdown signal)
  │     │
  │     └── OnStatusChange callback
  │           └── JsonEmitter::emit_status(...)
  │
  └── stdout → JSON Lines → Electron main process
```

## Focus States

| State          | Trigger                                   | Score Range |
| -------------- | ----------------------------------------- | ----------- |
| **focused**    | Centered gaze, calm vitals                | 0.7 - 1.0   |
| **distracted** | Gaze deviation above threshold            | 0.2 - 0.6   |
| **drowsy**     | High blink rate, slow breathing           | 0.1 - 0.2   |
| **stressed**   | Elevated pulse + fast breathing + low HRV | 0.2 - 0.3   |
| **away**       | No face detected for 3+ seconds           | 0.0         |
| **talking**    | Mouth movement detected                   | 0.2 - 0.4   |
| **unknown**    | Insufficient data or low confidence       | 0.5         |
