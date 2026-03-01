/**
 * @module useMultiplayer
 *
 * React hook that manages the WebSocket connection for multiplayer.
 *
 * Provides:
 * - Connection lifecycle: `createRoom`, `joinRoom`, `disconnect`
 * - Shared state: `sharedState` (authoritative GameState from server)
 * - Remote cursors: `cursors` (other players' world-space positions)
 * - Action senders: `sendAdjustTrait`, `sendSetBehavior`, `sendReproduce`, `sendRestart`, `sendCursorMove`
 * - Status / errors: `status`, `error`
 *
 * The hook auto-detects dev vs production environments to pick the right
 * WebSocket URL (dev: separate port 5001, prod: same host/port).
 */

import { useRef, useEffect, useState, useCallback } from 'react'
import type { ClientMessage, ServerMessage, SharedGameState } from '../shared/protocol'
import type { TraitKey, BehaviorKey } from '../types'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected'

interface UseMultiplayerReturn {
  status: ConnectionStatus
  roomCode: string | null
  playerId: string | null
  playerCount: number
  sharedState: SharedGameState | null
  cursors: Record<string, { x: number; y: number }>
  error: string | null
  createRoom: () => void
  joinRoom: (code: string) => void
  sendAdjustTrait: (id: string, trait: TraitKey, delta: number) => void
  sendSetBehavior: (id: string, key: BehaviorKey, value: number) => void
  sendReproduce: (parentId: string) => void
  sendRestart: () => void
  sendCursorMove: (x: number, y: number) => void
  disconnect: () => void
}

export function useMultiplayer(): UseMultiplayerReturn {
  const wsRef = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [roomCode, setRoomCode] = useState<string | null>(null)
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [playerCount, setPlayerCount] = useState(0)
  const [sharedState, setSharedState] = useState<SharedGameState | null>(null)
  const [cursors, setCursors] = useState<Record<string, { x: number; y: number }>>({})
  const [error, setError] = useState<string | null>(null)

  const pendingAction = useRef<ClientMessage | null>(null)

  const sendMessage = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }, [])

  const connect = useCallback(() => {
    if (wsRef.current) return

    setStatus('connecting')
    setError(null)

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    // In production, WS runs on same host/port; in dev, use separate port 5001
    const isDev = window.location.port === '5173' || window.location.port === '5174'
    const wsUrl = isDev
      ? `${protocol}//${window.location.hostname}:5001`
      : `${protocol}//${window.location.host}`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setStatus('connected')
      // Send pending action (create or join) that triggered the connection
      if (pendingAction.current) {
        sendMessage(pendingAction.current)
        pendingAction.current = null
      }
    }

    ws.onmessage = (event) => {
      const msg: ServerMessage = JSON.parse(event.data)

      switch (msg.type) {
        case 'ROOM_CREATED':
          setRoomCode(msg.roomCode)
          setPlayerId(msg.playerId)
          setPlayerCount(1)
          break

        case 'ROOM_JOINED':
          setRoomCode(msg.roomCode)
          setPlayerId(msg.playerId)
          setSharedState(msg.state)
          break

        case 'STATE_UPDATE':
          setSharedState(msg.state)
          break

        case 'PLAYER_JOINED':
          setPlayerCount(msg.playerCount)
          break

        case 'PLAYER_LEFT':
          setPlayerCount(msg.playerCount)
          break

        case 'CURSORS':
          setCursors(msg.cursors)
          break

        case 'ERROR':
          setError(msg.message)
          break
      }
    }

    ws.onclose = () => {
      wsRef.current = null
      setStatus('disconnected')
    }

    ws.onerror = () => {
      setError('Connection failed. Is the server running?')
    }
  }, [sendMessage])

  const createRoom = useCallback(() => {
    pendingAction.current = { type: 'CREATE_ROOM' }
    connect()
  }, [connect])

  const joinRoom = useCallback((code: string) => {
    pendingAction.current = { type: 'JOIN_ROOM', roomCode: code.toUpperCase() }
    connect()
  }, [connect])

  const disconnect = useCallback(() => {
    wsRef.current?.close()
    wsRef.current = null
    setStatus('disconnected')
    setRoomCode(null)
    setPlayerId(null)
    setPlayerCount(0)
    setSharedState(null)
    setCursors({})
    setError(null)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close()
    }
  }, [])

  return {
    status,
    roomCode,
    playerId,
    playerCount,
    sharedState,
    cursors,
    error,
    createRoom,
    joinRoom,
    sendAdjustTrait: useCallback((id, trait, delta) =>
      sendMessage({ type: 'ADJUST_TRAIT', id, trait, delta }), [sendMessage]),
    sendSetBehavior: useCallback((id, key, value) =>
      sendMessage({ type: 'SET_BEHAVIOR', id, key, value }), [sendMessage]),
    sendReproduce: useCallback((parentId) =>
      sendMessage({ type: 'REPRODUCE', parentId }), [sendMessage]),
    sendRestart: useCallback(() =>
      sendMessage({ type: 'RESTART' }), [sendMessage]),
    sendCursorMove: useCallback((x, y) =>
      sendMessage({ type: 'CURSOR_MOVE', x, y }), [sendMessage]),
    disconnect,
  }
}
