/**
 * @module protocol
 *
 * Shared message types for client ↔ server WebSocket communication.
 *
 * Imported by both the browser client (`useMultiplayer` hook) and the
 * Node.js server (`server.ts`). Keeping them in one file guarantees
 * the two sides stay in sync.
 *
 * - `SharedGameState` — the subset of `GameState` broadcast to all clients.
 * - `ClientMessage`   — messages the client sends to the server.
 * - `ServerMessage`   — messages the server sends to (each) client.
 */

import type { BacteriaState, Nutrient, Species, TraitKey, BehaviorKey } from '../types'

/** The authoritative game state broadcast from the server at ~10 Hz. */

export interface SharedGameState {
  bacteria: BacteriaState[]
  nutrients: Nutrient[]
  tick: number
  worldWidth: number
  worldHeight: number
  species: Species[]
}

// ── Client → Server messages ──

export type ClientMessage =
  | { type: 'CREATE_ROOM' }
  | { type: 'JOIN_ROOM'; roomCode: string }
  | { type: 'ADJUST_TRAIT'; id: string; trait: TraitKey; delta: number }
  | { type: 'SET_BEHAVIOR'; id: string; key: BehaviorKey; value: number }
  | { type: 'REPRODUCE'; parentId: string }
  | { type: 'RESTART' }
  | { type: 'CURSOR_MOVE'; x: number; y: number }

// ── Server → Client messages ──

export type ServerMessage =
  | { type: 'ROOM_CREATED'; roomCode: string; playerId: string }
  | { type: 'ROOM_JOINED'; roomCode: string; playerId: string; state: SharedGameState }
  | { type: 'STATE_UPDATE'; state: SharedGameState }
  | { type: 'PLAYER_JOINED'; playerId: string; playerCount: number }
  | { type: 'PLAYER_LEFT'; playerId: string; playerCount: number }
  | { type: 'CURSORS'; cursors: Record<string, { x: number; y: number }> }
  | { type: 'ERROR'; message: string }
