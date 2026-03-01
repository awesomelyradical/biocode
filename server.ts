/**
 * @module server
 *
 * Production Node.js server for Biocode.
 *
 * Serves two roles on a single port (set via `PORT` env var, default 5001):
 *
 * 1. **HTTP static file server** — serves the Vite-built `dist/` assets with
 *    proper MIME types and SPA fallback to `index.html`. Includes path-traversal
 *    protection.
 *
 * 2. **WebSocket multiplayer server** — manages game rooms where:
 *    - Each room holds its own `GameState` and runs an independent 30-tps
 *      simulation tick loop via `setInterval`.
 *    - State is broadcast to all room members at ~10 Hz (every 3rd tick).
 *    - Player cursor positions are relayed so each client can render remote cursors.
 *    - Clients can adjust traits, change behaviors, trigger reproduction, or
 *      restart the simulation; those actions are applied to the room's authoritative
 *      state via the shared `gameReducer`.
 *    - Empty rooms are cleaned up automatically when the last player disconnects.
 */

import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import { gameReducer } from './src/gameReducer.ts'
import { species, spawnInitialPopulation, WORLD_WIDTH, WORLD_HEIGHT } from './src/data.ts'
import type { GameState } from './src/types.ts'
import type { ClientMessage, ServerMessage, SharedGameState } from './src/shared/protocol.ts'

// ── Room management ──

interface Player {
  id: string
  ws: WebSocket
  cursor: { x: number; y: number }
}

interface Room {
  code: string
  state: GameState
  players: Map<string, Player>
  tickInterval: ReturnType<typeof setInterval> | null
  broadcastCounter: number
}

const rooms = new Map<string, Room>()
let nextPlayerId = 1

/** Generate a 4-char room code from an unambiguous alphanumeric set. Recurse on collision. */
function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no ambiguous chars
  let code = ''
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return rooms.has(code) ? generateRoomCode() : code
}

/** Build the initial GameState for a new room. */
function createRoomState(): GameState {
  return {
    bacteria: spawnInitialPopulation(WORLD_WIDTH, WORLD_HEIGHT, 25),
    nutrients: [],
    species,
    camera: { x: 0, y: 0, zoom: 1 },
    selectedId: null,
    tick: 0,
    worldWidth: WORLD_WIDTH,
    worldHeight: WORLD_HEIGHT,
    paused: false,
    biomass: 0,
    store: {
      unlocked: new Set<string>(),
      equipped: { colors: null, patterns: null, backgrounds: null, music: null },
    },
  }
}

/** Extract the subset of game state that gets broadcast to all clients. */
function extractSharedState(state: GameState): SharedGameState {
  return {
    bacteria: state.bacteria,
    nutrients: state.nutrients,
    tick: state.tick,
    worldWidth: state.worldWidth,
    worldHeight: state.worldHeight,
    species: state.species,
  }
}

/** Send a message to a single WebSocket client. */
function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

/** Send a message to every player in a room. */
function broadcast(room: Room, msg: ServerMessage) {
  const data = JSON.stringify(msg)
  for (const player of room.players.values()) {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data)
    }
  }
}

/** Start the 30-tps simulation tick loop for a room. Broadcasts state at ~10 Hz. */
function startRoomTick(room: Room) {
  if (room.tickInterval) return
  room.broadcastCounter = 0

  room.tickInterval = setInterval(() => {
    // Run simulation tick (mouseX/Y = 0 disables cursor reactivity on server)
    room.state = gameReducer(room.state, { type: 'TICK', mouseX: 0, mouseY: 0 })
    room.broadcastCounter++

    // Broadcast state every 3rd tick (10 Hz at 30 tps)
    if (room.broadcastCounter >= 3) {
      room.broadcastCounter = 0
      broadcast(room, { type: 'STATE_UPDATE', state: extractSharedState(room.state) })
    }

    // Broadcast cursors every 3rd tick as well
    if (room.broadcastCounter === 1) {
      const cursors: Record<string, { x: number; y: number }> = {}
      for (const [id, p] of room.players) {
        cursors[id] = p.cursor
      }
      broadcast(room, { type: 'CURSORS', cursors })
    }
  }, 1000 / 30)
}

/** Stop the tick loop for a room. */
function stopRoomTick(room: Room) {
  if (room.tickInterval) {
    clearInterval(room.tickInterval)
    room.tickInterval = null
  }
}

/** Remove a player from their room and clean up empty rooms. */
function removePlayerFromRoom(playerId: string, room: Room) {
  room.players.delete(playerId)
  broadcast(room, { type: 'PLAYER_LEFT', playerId, playerCount: room.players.size })

  if (room.players.size === 0) {
    stopRoomTick(room)
    rooms.delete(room.code)
    console.log(`Room ${room.code} closed (empty)`)
  }
}

// ── HTTP server (serves static files from dist/) ──

const PORT = Number(process.env.PORT) || 5001
const DIST = join(import.meta.dirname, 'dist')

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

const httpServer = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  let filePath = join(DIST, url.pathname === '/' ? 'index.html' : url.pathname)

  // Prevent path traversal
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403)
    res.end()
    return
  }

  if (!existsSync(filePath)) {
    // SPA fallback
    filePath = join(DIST, 'index.html')
  }

  try {
    const data = readFileSync(filePath)
    const ext = extname(filePath)
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
    res.end(data)
  } catch {
    res.writeHead(404)
    res.end('Not found')
  }
})

const wss = new WebSocketServer({ server: httpServer })
httpServer.listen(PORT, () => {
  console.log(`Biocode server running on http://localhost:${PORT}`)
})

wss.on('connection', (ws) => {
  const playerId = `p${nextPlayerId++}`
  let currentRoom: Room | null = null

  ws.on('message', (raw) => {
    let msg: ClientMessage
    try {
      msg = JSON.parse(String(raw))
    } catch {
      return
    }

    switch (msg.type) {
      case 'CREATE_ROOM': {
        if (currentRoom) {
          send(ws, { type: 'ERROR', message: 'Already in a room' })
          return
        }
        const code = generateRoomCode()
        const room: Room = {
          code,
          state: createRoomState(),
          players: new Map(),
          tickInterval: null,
          broadcastCounter: 0,
        }
        room.players.set(playerId, { id: playerId, ws, cursor: { x: 0, y: 0 } })
        rooms.set(code, room)
        currentRoom = room

        send(ws, { type: 'ROOM_CREATED', roomCode: code, playerId })
        startRoomTick(room)
        console.log(`Room ${code} created by ${playerId}`)
        break
      }

      case 'JOIN_ROOM': {
        if (currentRoom) {
          send(ws, { type: 'ERROR', message: 'Already in a room' })
          return
        }
        const room = rooms.get(msg.roomCode.toUpperCase())
        if (!room) {
          send(ws, { type: 'ERROR', message: 'Room not found' })
          return
        }
        room.players.set(playerId, { id: playerId, ws, cursor: { x: 0, y: 0 } })
        currentRoom = room

        send(ws, { type: 'ROOM_JOINED', roomCode: room.code, playerId, state: extractSharedState(room.state) })
        broadcast(room, { type: 'PLAYER_JOINED', playerId, playerCount: room.players.size })
        console.log(`${playerId} joined room ${room.code} (${room.players.size} players)`)
        break
      }

      case 'ADJUST_TRAIT': {
        if (!currentRoom) return
        currentRoom.state = gameReducer(currentRoom.state, {
          type: 'ADJUST_TRAIT',
          id: msg.id,
          trait: msg.trait,
          delta: msg.delta,
        })
        break
      }

      case 'SET_BEHAVIOR': {
        if (!currentRoom) return
        currentRoom.state = gameReducer(currentRoom.state, {
          type: 'SET_BEHAVIOR',
          id: msg.id,
          key: msg.key,
          value: msg.value,
        })
        break
      }

      case 'REPRODUCE': {
        if (!currentRoom) return
        currentRoom.state = gameReducer(currentRoom.state, {
          type: 'REPRODUCE',
          parentId: msg.parentId,
        })
        break
      }

      case 'RESTART': {
        if (!currentRoom) return
        currentRoom.state = gameReducer(currentRoom.state, { type: 'RESTART' })
        // Broadcast immediately after restart so all clients see new state
        broadcast(currentRoom, { type: 'STATE_UPDATE', state: extractSharedState(currentRoom.state) })
        break
      }

      case 'CURSOR_MOVE': {
        if (!currentRoom) return
        const player = currentRoom.players.get(playerId)
        if (player) {
          player.cursor = { x: msg.x, y: msg.y }
        }
        break
      }
    }
  })

  ws.on('close', () => {
    if (currentRoom) {
      removePlayerFromRoom(playerId, currentRoom)
      console.log(`${playerId} disconnected`)
    }
  })

  ws.on('error', () => {
    if (currentRoom) {
      removePlayerFromRoom(playerId, currentRoom)
    }
  })
})
