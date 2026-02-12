# Focus Wizard

Focus Wizard is an AI-powered productivity companion that combines a Pomodoro timer with real-time focus tracking and a Solana-based "Stake-to-Focus" incentive system.

The app features a pixel-art wizard that monitors your productivity. If you stay focused, the wizard stays happy; if you get distracted, the wizard gets angry and might even cast a "spell" (fireworks overlay) to remind you to get back to work!

## Features

- **AI-Powered Focus Tracking**: Uses Google's Gemini AI vision models to analyze your screen and determine if you're on task based on your custom goals.
- **Stake-to-Focus (Solana)**: Lock up SOL in a vault and "earn" it back by successfully completing Pomodoro work cycles. Fail to focus, and your progress is penalized!
- **Interactive Pixel Art**: A reactive wizard character with multiple animations and states (Happy, Neutral, Mad, Sleeping, Spell-casting).
- **Integrated Pomodoro**: Fully configurable work/break cycles integrated with the incentive and tracking systems.

## Architecture

The project is composed of two main components:

- **wizard-electron**: The React + Electron frontend. Handles the UI, Pomodoro logic, screenshot capture, and AI analysis.
- **deno-backend**: A Deno server that interfaces with Google Gemini for productivity analysis and manages the Solana wallet/vault logic.

## Getting Started

### Prerequisites

- Node.js (for Electron frontend)
- Deno (for backend)
- Google Gemini API Key (for screen analysis)

### Setup & Installation

1. Clone the repository:

```bash
git clone https://github.com/your-repo/focus-wizard.git
cd focus-wizard
```

2. Configure Environment Variables: Create a .env file in the deno-backend directory:

```
# Required: Google Gemini API Key for productivity analysis
GEMINI_API_KEY=your_gemini_key

# Optional: Backend server configuration
PORT=8000

# Optional: Solana RPC endpoint (defaults to mainnet)
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Optional: CORS origins (defaults to allowing all origins in development)
# ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

3. Start the Deno Backend:

```bash
cd deno-backend
deno install
deno run dev
```

4. Install & Start the Electron App:

```bash
cd wizard-electron
npm install
npm run dev
```

## Development

### Project Structure

- `/wizard-electron`: React + Vite + Electron source code.
- `/deno-backend`: Deno (Oak) server, Gemini integration, and Solana wallet logic.
- `/shared`: Shared Zod schemas used across Deno and Electron.

### Key Commands

- **Electron**: `npm run dev` (development), `npm run build` (production build).
- **Deno**: `deno install && deno run dev` (watch mode), `deno task start` (production).

## Stake-to-Focus Logic

- **Vault**: Send SOL to the generated vault address (see Wallet settings in the app).
- **Earning**: Completing a work cycle moves a configurable amount of SOL (default 0.001 SOL) from the Vault to your Earned balance.
- **Withdrawal**: You can withdraw your Earned balance back to your main Solana wallet at any time.
- **Penalty**: If the wizard detects you are distracted ("Mad" state), the Pomodoro timer counts up instead of down, forcing you to focus longer to earn your reward.

## License

MIT
