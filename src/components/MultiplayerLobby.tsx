/**
 * @module MultiplayerLobby
 *
 * Pre-game lobby screen for multiplayer.
 * Lets the player create a new room or join an existing one with a 4-character
 * room code. Also reads `?room=` from the URL to auto-fill the join code.
 */

import { useState, useEffect } from 'react'

interface MultiplayerLobbyProps {
  onCreateRoom: () => void
  onJoinRoom: (code: string) => void
  onBack: () => void
}

export function MultiplayerLobby({ onCreateRoom, onJoinRoom, onBack }: MultiplayerLobbyProps) {
  const [roomCode, setRoomCode] = useState('')
  const [show, setShow] = useState(false)

  useEffect(() => {
    requestAnimationFrame(() => setShow(true))
  }, [])

  // Check URL for room code
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('room')
    if (code) {
      setRoomCode(code.toUpperCase())
    }
  }, [])

  const handleJoin = () => {
    const code = roomCode.trim().toUpperCase()
    if (code.length === 4) {
      onJoinRoom(code)
    }
  }

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center transition-all duration-500 ${show ? 'opacity-100' : 'opacity-0'}`}
      style={{ background: 'oklch(0.08 0.02 240)' }}
    >
      <div className={`flex flex-col items-center gap-8 transition-all duration-700 ${show ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
        <div className="flex flex-col items-center gap-2">
          <h1
            className="text-4xl md:text-6xl font-black tracking-widest"
            style={{
              color: 'oklch(0.70 0.18 240)',
              textShadow: '0 0 40px oklch(0.70 0.18 240 / 0.4)',
            }}
          >
            MULTIPLAYER
          </h1>
          <p className="text-sm tracking-[0.3em] uppercase text-white/40 font-light">
            Share a petri dish
          </p>
        </div>

        {/* Create room */}
        <button
          onClick={onCreateRoom}
          className="w-72 px-8 py-4 rounded-xl border-2 text-lg font-semibold tracking-wider uppercase transition-all duration-300 cursor-pointer hover:scale-105 active:scale-95"
          style={{
            borderColor: 'oklch(0.70 0.18 145 / 0.5)',
            color: 'oklch(0.85 0.15 145)',
            background: 'oklch(0.70 0.18 145 / 0.08)',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'oklch(0.70 0.18 145 / 0.2)'
            e.currentTarget.style.borderColor = 'oklch(0.70 0.18 145 / 0.8)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'oklch(0.70 0.18 145 / 0.08)'
            e.currentTarget.style.borderColor = 'oklch(0.70 0.18 145 / 0.5)'
          }}
        >
          Create Room
        </button>

        {/* Join room */}
        <div className="flex flex-col items-center gap-3">
          <div className="text-white/30 text-sm uppercase tracking-widest">— or join —</div>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={roomCode}
              onChange={e => setRoomCode(e.target.value.toUpperCase().slice(0, 4))}
              placeholder="CODE"
              maxLength={4}
              className="w-32 px-4 py-3 rounded-lg border-2 text-center text-xl font-mono font-bold tracking-[0.4em] uppercase outline-none transition-colors"
              style={{
                borderColor: 'oklch(0.60 0.12 240 / 0.4)',
                background: 'oklch(0.12 0.02 240)',
                color: 'oklch(0.85 0.15 240)',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = 'oklch(0.70 0.18 240 / 0.8)' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'oklch(0.60 0.12 240 / 0.4)' }}
              onKeyDown={e => { if (e.key === 'Enter') handleJoin() }}
            />
            <button
              onClick={handleJoin}
              disabled={roomCode.length < 4}
              className="px-6 py-3 rounded-lg border-2 text-lg font-semibold tracking-wider uppercase transition-all duration-300 cursor-pointer hover:scale-105 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                borderColor: 'oklch(0.70 0.18 240 / 0.5)',
                color: 'oklch(0.85 0.15 240)',
                background: 'oklch(0.70 0.18 240 / 0.08)',
              }}
            >
              Join
            </button>
          </div>
        </div>

        {/* Back */}
        <button
          onClick={onBack}
          className="mt-4 text-white/30 hover:text-white/60 text-sm tracking-wider uppercase transition-colors cursor-pointer"
        >
          ← Back
        </button>
      </div>
    </div>
  )
}
