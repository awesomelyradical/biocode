/**
 * @module MultiplayerGame
 *
 * Wraps the PetriDish renderer for multiplayer sessions.
 *
 * Connects to the WebSocket server via `useMultiplayer`, builds a local
 * `GameState` from the authoritative `SharedGameState` + local camera/selection,
 * and intercepts dispatched actions to forward them over the socket instead
 * of reducing them locally. Renders remote player cursors and multiplayer HUD.
 */

import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { PetriDish } from './PetriDish'
import { BacteriaModPanel } from './BacteriaModPanel'
import { HUD } from './HUD'
import { useMultiplayer } from '../hooks/useMultiplayer'
import { species, WORLD_WIDTH, WORLD_HEIGHT } from '../data'
import type { GameState, GameAction, CameraState, BacteriaState } from '../types'

interface MultiplayerGameProps {
  roomCode?: string          // if provided, join this room; otherwise create new
  onDisconnect: () => void   // return to menu
}

export function MultiplayerGame({ roomCode: initialRoomCode, onDisconnect }: MultiplayerGameProps) {
  const mp = useMultiplayer()
  const [camera, setCamera] = useState<CameraState>({ x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2, zoom: 0.5 })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const mouseWorldRef = useRef({ x: 0, y: 0 })
  const hasJoinedRef = useRef(false)

  // Connect on mount
  useEffect(() => {
    if (hasJoinedRef.current) return
    hasJoinedRef.current = true
    if (initialRoomCode) {
      mp.joinRoom(initialRoomCode)
    } else {
      mp.createRoom()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Broadcast cursor position at ~10 Hz
  useEffect(() => {
    if (mp.status !== 'connected') return
    const interval = setInterval(() => {
      mp.sendCursorMove(mouseWorldRef.current.x, mouseWorldRef.current.y)
    }, 100)
    return () => clearInterval(interval)
  }, [mp.status, mp.sendCursorMove])

  // Build a GameState from the shared state + local client state
  const gameState: GameState = useMemo(() => {
    if (!mp.sharedState) {
      return {
        bacteria: [],
        nutrients: [],
        species,
        camera,
        selectedId,
        tick: 0,
        worldWidth: WORLD_WIDTH,
        worldHeight: WORLD_HEIGHT,
        paused: false,
        biomass: 0,
        store: {
          unlocked: new Set<string>(['bg-dark-void']),
          equipped: { colors: null, patterns: null, backgrounds: 'bg-dark-void', music: null },
        },
      }
    }
    return {
      bacteria: mp.sharedState.bacteria,
      nutrients: mp.sharedState.nutrients,
      species: mp.sharedState.species,
      camera,
      selectedId,
      tick: mp.sharedState.tick,
      worldWidth: mp.sharedState.worldWidth,
      worldHeight: mp.sharedState.worldHeight,
      paused: false,
      biomass: 0,
      store: {
        unlocked: new Set<string>(['bg-dark-void']),
        equipped: { colors: null, patterns: null, backgrounds: 'bg-dark-void', music: null },
      },
    }
  }, [mp.sharedState, camera, selectedId])

  // Clear selection if the selected bacterium no longer exists
  useEffect(() => {
    if (selectedId && mp.sharedState) {
      const exists = mp.sharedState.bacteria.some(b => b.id === selectedId)
      if (!exists) setSelectedId(null)
    }
  }, [mp.sharedState, selectedId])

  // Multiplayer dispatch intercepts game actions and sends them over WebSocket
  const mpDispatch: React.Dispatch<GameAction> = useCallback((action: GameAction) => {
    switch (action.type) {
      case 'SELECT':
        setSelectedId(action.id)
        break
      case 'SET_CAMERA':
        setCamera(prev => ({ ...prev, ...action.camera }))
        break
      case 'ADJUST_TRAIT':
        mp.sendAdjustTrait(action.id, action.trait, action.delta)
        break
      case 'SET_BEHAVIOR':
        mp.sendSetBehavior(action.id, action.key, action.value)
        break
      case 'REPRODUCE':
        mp.sendReproduce(action.parentId)
        break
      case 'RESTART':
        mp.sendRestart()
        break
      // TICK, SPAWN, REMOVE, BUY_ITEM, etc. are client-local or server-only — ignore
    }
  }, [mp])

  const selectedBacterium: BacteriaState | undefined = selectedId
    ? gameState.bacteria.find(b => b.id === selectedId)
    : undefined

  const handleCloseModPanel = useCallback(() => setSelectedId(null), [])

  // Remote cursors (exclude self)
  const remoteCursors = useMemo(() => {
    const result: Record<string, { x: number; y: number }> = {}
    for (const [id, pos] of Object.entries(mp.cursors)) {
      if (id !== mp.playerId) result[id] = pos
    }
    return result
  }, [mp.cursors, mp.playerId])

  return (
    <div className="relative w-full h-screen overflow-hidden bg-background">
      {mp.status === 'connecting' && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="text-primary text-lg animate-pulse">Connecting...</div>
        </div>
      )}

      {mp.error && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/80 gap-4">
          <div className="text-red-400 text-lg">{mp.error}</div>
          <button
            onClick={onDisconnect}
            className="px-6 py-2 rounded-lg border border-primary/40 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
          >
            Back to Menu
          </button>
        </div>
      )}

      <PetriDish
        state={gameState}
        dispatch={mpDispatch}
        mouseWorldRef={mouseWorldRef}
        remoteCursors={remoteCursors}
      />

      <HUD
        state={gameState}
        dispatch={mpDispatch}
        onOpenStore={() => {}}
        multiplayerInfo={{
          roomCode: mp.roomCode,
          playerCount: mp.playerCount,
          onLeave: () => { mp.disconnect(); onDisconnect() },
        }}
      />

      {selectedBacterium && (
        <BacteriaModPanel
          bacterium={selectedBacterium}
          dispatch={mpDispatch}
          onClose={handleCloseModPanel}
        />
      )}
    </div>
  )
}
