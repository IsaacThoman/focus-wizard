# React + TypeScript + Vite
# Focus Wizard 🧙‍♂️

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type aware lint rules:

- Configure the top-level `parserOptions` property like this:

```js
export default {
  // other rules...
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: ['./tsconfig.json', './tsconfig.node.json'],
    tsconfigRootDir: __dirname,
  },
}
```

- Replace `plugin:@typescript-eslint/recommended` to `plugin:@typescript-eslint/recommended-type-checked` or `plugin:@typescript-eslint/strict-type-checked`
- Optionally add `plugin:@typescript-eslint/stylistic-type-checked`
- Install [eslint-plugin-react](https://github.com/jsx-eslint/eslint-plugin-react) and add `plugin:react/recommended` & `plugin:react/jsx-runtime` to the `extends` list

A desktop focus app that uses your webcam to determine if you're staying on task — powered by [Presage SmartSpectra SDK](https://github.com/Presage-Security/SmartSpectra) for real-time physiological sensing.

## Architecture

The SmartSpectra C++ SDK runs in a **Docker container** (Ubuntu 22.04) so it works on macOS, Windows, and Linux without native SDK installation. The Electron app captures webcam frames and exchanges them with the container via a shared volume.

```
┌─── Your Mac / Windows / Linux ──────────────────────────┐
│                                                          │
│  Electron App (Vite + React)                             │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Renderer: getUserMedia → canvas → JPEG frames      │  │
│  │           Focus dashboard UI (score, vitals, state) │  │
│  └─────────────┬─────────────────────▲────────────────┘  │
│                │ IPC                 │ IPC                │
│  ┌─────────────▼─────────────────────┤────────────────┐  │
│  │ Main Process: writes frames → /tmp/focus-frames/   │  │
│  │              parses JSON Lines ← bridge stdout      │  │
│  └──────┬────────────────────────────▲────────────────┘  │
│         │ docker run                 │ stdout (JSON)     │
│  ┌──────▼────────────────────────────┤────────────────┐  │
│  │ Docker (Ubuntu 22.04)             │                │  │
│  │   C++ Bridge ← SmartSpectra SDK                    │  │
│  │   FileStreamVideoSource reads /frames/*.jpg        │  │
│  │   Emits focus state + vitals as JSON Lines         │  │
│  └────────────────────────────────────────────────────┘  │
│         volume mount: /tmp/focus-frames → /frames        │
└──────────────────────────────────────────────────────────┘
```

### What We Detect

| Signal | Source | Focus Indicator |
|--------|--------|-----------------|
| **Gaze / Iris Tracking** | SmartSpectra Myofacial | Looking away from screen |
| **Blink Rate** | SmartSpectra Myofacial | Fatigue / drowsiness |
| **Face Presence** | SmartSpectra Myofacial | User left their desk |
| **Pulse Rate / HRV** | SmartSpectra Cardiac | Stress / boredom (low HRV) |
| **Breathing Rate** | SmartSpectra Breathing | Anxiety / relaxation state |
| **Talking Detection** | SmartSpectra Myofacial | On a call / distracted |

### Focus States

| State | Emoji | Description |
|-------|-------|-------------|
| Focused | 🎯 | On task — gaze centered, vitals calm |
| Distracted | 👀 | Gaze wandering, looking away frequently |
| Drowsy | 😴 | High blink rate, slow breathing |
| Stressed | 😰 | Elevated pulse, low HRV, fast breathing |
| Away | 🚶 | No face detected — user left desk |
| Talking | 🗣️ | User is speaking |

## Project Structure

```
focus-wizard/
├── bridge/                        # C++ SmartSpectra bridge
│   ├── Dockerfile                 # Ubuntu 22.04 + SDK + bridge build
│   ├── CMakeLists.txt
│   └── src/
│       ├── main.cpp               # Headless runner (local + server modes)
│       ├── json_emitter.hpp/cpp   # Thread-safe JSON Lines → stdout
│       ├── metrics_collector.hpp/cpp  # Extracts metrics from SDK callbacks
│       └── focus_analyzer.hpp/cpp # Derives focus state from raw metrics
├── app/                           # Electron desktop app (Vite + React + TS)
│   ├── package.json
│   ├── electron/
│   │   ├── main.ts                # Electron main process
│   │   ├── bridge-manager.ts      # Spawns Docker container or native binary
│   │   ├── frame-writer.ts        # Writes webcam frames to shared volume
│   │   └── preload.ts             # Secure IPC API for renderer
│   └── src/
│       ├── App.tsx                 # Dashboard UI
│       ├── App.css                # Dark theme styles
│       └── hooks/useWebcam.ts     # getUserMedia → JPEG frame capture
├── docker-compose.yml             # Dev convenience for standalone bridge
├── .gitignore
└── README.md
```

## Prerequisites

- **Docker Desktop** — [Install Docker](https://www.docker.com/products/docker-desktop/)
- **Node.js** ≥ 18 + npm
- **Presage API Key** — get one free at https://physiology.presagetech.com

> The Docker image (Ubuntu 22.04 + SmartSpectra SDK) is built automatically on first run. No native C++ toolchain needed on your machine.

## Quick Start

### 1. Get your API key

Register at https://physiology.presagetech.com and copy your API key.

### 2. Install & run the Electron app

```bash
cd app
npm install
npm run electron:dev
```

The app will:
1. Check that Docker is running
2. Build the `focus-wizard-bridge` Docker image (first run — takes a few minutes)
3. Prompt for your API key
4. Request camera access
5. Start streaming frames to the bridge container
6. Display real-time focus state and vitals

### Alternative: Build the Docker image ahead of time

```bash
# From the project root
docker build -t focus-wizard-bridge -f bridge/Dockerfile .
```

### Alternative: Run the bridge standalone (without Electron)

```bash
# Create a frame directory and start the container
mkdir -p /tmp/focus-wizard-frames
export SMARTSPECTRA_API_KEY=your_key_here
docker compose up --build
# (Feed frames to /tmp/focus-wizard-frames/ to see JSON output)
```

### Local Mode (Ubuntu with native SDK)

If you have the SmartSpectra SDK installed natively (Ubuntu 22.04):

```bash
# Build the bridge
cd bridge && mkdir build && cd build
cmake .. && make -j$(nproc)

# Run with direct webcam capture
./focus_bridge --api_key=YOUR_KEY --mode=local
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SMARTSPECTRA_API_KEY` | Your Presage Physiology API key |
| `FOCUS_BRIDGE_PATH` | Path to native `focus_bridge` binary (local mode only) |

## How It Works

1. **Webcam Capture**: The Electron renderer uses `getUserMedia()` to capture your webcam at 640×480 @ 15fps.

2. **Frame Transfer**: Each frame is JPEG-compressed in the browser canvas, sent via IPC to the main process, and written to a shared directory as `frame{timestamp}.jpg`.

3. **SmartSpectra Processing**: Inside the Docker container, SmartSpectra's `FileStreamVideoSource` reads these frames, runs them through MediaPipe face mesh and the Physiology Edge engine.

4. **Metrics Output**: The C++ bridge receives callbacks with physiological data (pulse, breathing, gaze, blinks, etc.) and emits JSON Lines on stdout.

5. **Focus Analysis**: A priority-based state machine analyzes the raw metrics to determine your focus state (Focused → Distracted → Drowsy → Stressed → Away).

6. **Dashboard**: The React UI renders the focus score, state, and vitals in real time.

## License

MIT — but note that SmartSpectra SDK is LGPL-3.0 licensed.