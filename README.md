# Biocode

A real-time bacteria simulation where you observe, interact with, and modify microorganisms in a virtual petri dish.

Built with React 19, Canvas 2D, TypeScript, and WebSocket multiplayer.

## Gameplay

- **5 species** — Coccus, Bacillus, Spirillum, Macrophage, Vibrio — each with unique shapes, speeds, and base stats.
- **Genetics** — Every bacterium carries a plasmid with redistributable trait points (speed, size, drag, bounce, sense radius, reproduction rate).
- **Behavior sliders** — Kin/xeno affinity, aggression, life/fecundity balance, and membrane permeability.
- **Cursor interaction** — Hover near cells to repel them; hover directly over a cell to catch it.
- **Predation & gene transfer** — Larger aggressive cells eat smaller ones and may absorb the prey's dominant trait.
- **Binary fission** — Cells reproduce automatically at high energy; you can also trigger it manually. Both parent and child are halved in size.
- **Burst death** — Any cell exceeding 3× its base size explodes into nutrient particles.
- **Cosmetic store** — Spend earned biomass on membrane colours, movement patterns, backgrounds, and procedurally-synthesised music.

## Controls

| Input | Action |
|---|---|
| Scroll wheel | Zoom |
| Shift + drag | Pan camera |
| Click / Tap | Select bacterium → open mod panel |
| Touch (1 finger) | Move cursor dot (attraction/repulsion) |
| Touch (2 fingers) | Pan + pinch zoom |

## Tech Stack

| Layer | Tech |
|---|---|
| UI framework | React 19 + TypeScript 5.7 |
| Bundler | Vite 7 |
| Styling | Tailwind CSS 4 |
| Rendering | Canvas 2D (`requestAnimationFrame` at 30 tps) |
| State | `useReducer` (pure reducer in `gameReducer.ts`) |
| Audio | Web Audio API — fully procedural, no audio files |
| Multiplayer | WebSocket via `ws` library |
| Server | Node.js HTTP + WS on a single port |

## Project Structure

```
server.ts                    Production server (HTTP static + WebSocket)
src/
  App.tsx                    Root component + screen router + splash screen
  types.ts                   All TypeScript interfaces and type unions
  data.ts                    Species definitions, trait/behavior configs, store items
  gameReducer.ts             Pure reducer — physics, collisions, energy, reproduction
  audio.ts                   Procedural Web Audio API synthesiser (5 ambience modes)
  shared/
    protocol.ts              Client ↔ server WebSocket message types
  hooks/
    useMultiplayer.ts         React hook for WebSocket connection management
  components/
    PetriDish.tsx             Canvas renderer + mouse/touch input handling
    BacteriaModPanel.tsx      Genome editing panel (ring chart + behavior sliders)
    HUD.tsx                   Heads-up display (population, zoom, stats, store)
    StorePanel.tsx            Cosmetic store overlay
    MultiplayerGame.tsx       Multiplayer game wrapper
    MultiplayerLobby.tsx      Room create/join screen
```

## Development

```bash
# Install dependencies
npm install

# Start the Vite dev server (port 5000)
npm run dev

# Start the WebSocket server (port 5001, for multiplayer in dev)
npm run server

# Production build
npm run build

# Run the production server (serves dist/ + WebSocket on one port)
npm start
```

## Deployment

The project is designed for a single-process deployment (e.g. Railway). `npm start` runs `tsx server.ts`, which serves the Vite build from `dist/` over HTTP and handles WebSocket connections on the same port.

Set the `PORT` environment variable to control the listening port (default: 5001).

## Credits

Vibecoded together by Aric and Juniper.
