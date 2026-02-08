Focus Wizard
Focus Wizard is an AI-powered productivity companion that combines a Pomodoro timer with real-time focus tracking and a Solana-based "Stake-to-Focus" incentive system.

The app features a pixel-art wizard that monitors your productivity. If you stay focused, the wizard stays happy; if you get distracted, the wizard gets angry and might even cast a "spell" (fireworks overlay) to remind you to get back to work!

Features
AI-Powered Focus Tracking: Uses OpenAI's vision models to analyze your screen and determine if you're on task based on your custom goals.
Physiological Analysis: Integrates the Presage SmartSpectra SDK via a C++ bridge to monitor gaze, blinks, and vitals (pulse, breathing) for deep focus detection.
Stake-to-Focus (Solana): Lock up SOL in a vault and "earn" it back by successfully completing Pomodoro work cycles. Fail to focus, and your progress is penalized!
Interactive Pixel Art: A reactive wizard character with multiple animations and states (Happy, Neutral, Mad, Sleeping, Spell-casting).
Integrated Pomodoro: Fully configurable work/break cycles integrated with the incentive and tracking systems.
Architecture
The project is composed of three main components:

wizard-electron: The React + Electron frontend. Handles the UI, Pomodoro logic, and orchestrates the other services.
deno-backend: A Deno server that interfaces with OpenAI for productivity analysis and manages the Solana wallet/vault logic.
bridge: A C++ component that captures webcam data and produces real-time physiological metrics using OpenCV and SmartSpectra.
Getting Started
Prerequisites
Node.js (for Electron frontend)
Deno (for backend)
Docker (recommended for running the C++ bridge)
OpenAI API Key (for screen analysis)
Presage SmartSpectra API Key (for physiological tracking)
Setup & Installation
Clone the repository:

git clone https://github.com/your-repo/focus-wizard.git
cd focus-wizard
Configure Environment Variables: Create a .env file in the deno-backend directory:

OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=gpt-4o-mini
Start the Deno Backend:

cd deno-backend
deno install
deno run dev
Start the C++ Bridge (via Docker):

# Set your SmartSpectra key
export SMARTSPECTRA_API_KEY=your_key
docker compose up --build
Install & Start the Electron App:

cd wizard-electron
npm install
npm run dev
Development
Project Structure
/wizard-electron: React + Vite + Electron source code.
/deno-backend: Deno (Oak) server, OpenAI integration, and Solana wallet logic.
/bridge: C++ source for the physiological monitor.
/shared: Shared Zod schemas used across Deno and Electron.
Key Commands
Electron: npm run dev (development), npm run build (production build).
Deno: deno install && deno run dev (watch mode), deno task start (production).
Bridge: cmake .. && make (if building natively).
Stake-to-Focus Logic
Vault: Send SOL to the generated vault address (see Wallet settings in the app).
Earning: Completing a work cycle moves a configurable amount of SOL (default 0.001 SOL) from the Vault to your Earned balance.
Withdrawal: You can withdraw your Earned balance back to your main Solana wallet at any time.
Penalty: If the wizard detects you are distracted ("Mad" state), the Pomodoro timer counts up instead of down, forcing you to focus longer to earn your reward.
License
MIT
