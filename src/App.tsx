/**
 * @module App
 *
 * Root application component and screen router.
 *
 * Screens:
 *  - `splash`        — Animated title screen with floating procedural cells.
 *                      "Begin Observation" → single-player, "Multiplayer" → lobby.
 *  - `singleplayer`  — Full simulation: PetriDish + HUD + StorePanel + BacteriaModPanel.
 *                      Runs a 30 tps game loop via `requestAnimationFrame`.
 *  - `mp-lobby`      — Room create / join UI.
 *  - `mp-game`       — Delegated to `MultiplayerGame` component.
 *
 * Also manages music playback — when a music store item is equipped, the
 * procedural audio engine (`audio.ts`) is started.
 */

import { useReducer, useEffect, useRef, useCallback, useState } from 'react'
import { PetriDish } from './components/PetriDish'
import { BacteriaModPanel } from './components/BacteriaModPanel'
import { StorePanel } from './components/StorePanel'
import { EquipSidebar } from './components/EquipSidebar'
import { HUD } from './components/HUD'
import { MultiplayerGame } from './components/MultiplayerGame'
import { MultiplayerLobby } from './components/MultiplayerLobby'
import { gameReducer } from './gameReducer'
import { species, spawnInitialPopulation, WORLD_WIDTH, WORLD_HEIGHT, WORLD_RADIUS } from './data'
import { playMusic } from './audio'
import type { GameState } from './types'

type AppScreen = 'splash' | 'singleplayer' | 'mp-lobby' | 'mp-game'

const initialState: GameState = {
  bacteria: spawnInitialPopulation(WORLD_RADIUS, 25),
  nutrients: [],
  antibiotics: [],
  bonds: [],
  species,
  camera: { x: WORLD_RADIUS, y: WORLD_RADIUS, zoom: 0.4 },
  selectedId: null,
  tick: 0,
  worldWidth: WORLD_WIDTH,
  worldHeight: WORLD_HEIGHT,
  worldRadius: WORLD_RADIUS,
  paused: false,
  biomass: 0,
  store: {
    unlocked: new Set(['bg-dark-void']),
    equipped: { colors: null, patterns: null, backgrounds: 'bg-dark-void', music: null, tools: null },
  },
  nutrientProfile: 'standard',
}

function SplashScreen({ onPlay, onMultiplayer }: { onPlay: () => void; onMultiplayer: () => void }) {
  const [show, setShow] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    requestAnimationFrame(() => setShow(true))
  }, [])

  // Animated background cells
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    let raf = 0

    const cells: { x: number; y: number; r: number; vx: number; vy: number; color: string; phase: number }[] = []
    const colors = ['oklch(0.72 0.19 145)', 'oklch(0.65 0.16 200)', 'oklch(0.70 0.20 30)', 'oklch(0.60 0.14 280)', 'oklch(0.75 0.18 60)']
    for (let i = 0; i < 40; i++) {
      cells.push({
        x: Math.random() * 2000, y: Math.random() * 1200,
        r: 8 + Math.random() * 25,
        vx: (Math.random() - 0.5) * 0.6,
        vy: (Math.random() - 0.5) * 0.6,
        color: colors[Math.floor(Math.random() * colors.length)],
        phase: Math.random() * Math.PI * 2,
      })
    }

    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const t = performance.now() / 1000
      for (const c of cells) {
        c.x += c.vx
        c.y += c.vy
        if (c.x < -50) c.x = w + 50
        if (c.x > w + 50) c.x = -50
        if (c.y < -50) c.y = h + 50
        if (c.y > h + 50) c.y = -50

        const pulse = 1 + Math.sin(t * 1.5 + c.phase) * 0.08
        const r = c.r * pulse

        // Glow
        const grad = ctx.createRadialGradient(c.x, c.y, r * 0.2, c.x, c.y, r * 2.5)
        grad.addColorStop(0, c.color)
        grad.addColorStop(1, 'transparent')
        ctx.globalAlpha = 0.12
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(c.x, c.y, r * 2.5, 0, Math.PI * 2)
        ctx.fill()

        // Cell body
        ctx.globalAlpha = 0.4
        ctx.fillStyle = c.color
        ctx.beginPath()
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2)
        ctx.fill()

        // Membrane
        ctx.globalAlpha = 0.25
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }

      ctx.globalAlpha = 1
      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  const handlePlay = () => {
    setShow(false)
    setTimeout(onPlay, 500)
  }

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center transition-all duration-500 ${show ? 'opacity-100' : 'opacity-0'}`}
      style={{ background: 'oklch(0.08 0.02 145)' }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
      />
      <div className={`relative z-10 flex flex-col items-center gap-8 transition-all duration-700 ${show ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
        <div className="flex flex-col items-center gap-2">
          <h1
            className="text-6xl md:text-8xl font-black tracking-widest"
            style={{
              color: 'oklch(0.75 0.18 145)',
              textShadow: '0 0 40px oklch(0.75 0.18 145 / 0.4), 0 0 80px oklch(0.75 0.18 145 / 0.15)',
            }}
          >
            BIOCODE
          </h1>
          <p className="text-sm md:text-base tracking-[0.3em] uppercase text-white/40 font-light">
            A microscopic ecosystem
          </p>
        </div>

        <div className="flex flex-col items-center gap-4 mt-4">
          <button
            onClick={handlePlay}
            className="group relative px-12 py-4 rounded-full border-2 text-lg font-semibold tracking-wider uppercase transition-all duration-300 cursor-pointer hover:scale-105 active:scale-95"
            style={{
              borderColor: 'oklch(0.75 0.18 145 / 0.5)',
              color: 'oklch(0.85 0.15 145)',
              background: 'oklch(0.75 0.18 145 / 0.08)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'oklch(0.75 0.18 145 / 0.2)'
              e.currentTarget.style.borderColor = 'oklch(0.75 0.18 145 / 0.8)'
              e.currentTarget.style.boxShadow = '0 0 30px oklch(0.75 0.18 145 / 0.3)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'oklch(0.75 0.18 145 / 0.08)'
              e.currentTarget.style.borderColor = 'oklch(0.75 0.18 145 / 0.5)'
              e.currentTarget.style.boxShadow = 'none'
            }}
          >
            Begin Observation
          </button>

          <button
            onClick={() => { setShow(false); setTimeout(onMultiplayer, 500) }}
            className="group relative px-10 py-3 rounded-full border-2 text-base font-semibold tracking-wider uppercase transition-all duration-300 cursor-pointer hover:scale-105 active:scale-95"
            style={{
              borderColor: 'oklch(0.65 0.16 240 / 0.5)',
              color: 'oklch(0.80 0.14 240)',
              background: 'oklch(0.65 0.16 240 / 0.08)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'oklch(0.65 0.16 240 / 0.2)'
              e.currentTarget.style.borderColor = 'oklch(0.65 0.16 240 / 0.8)'
              e.currentTarget.style.boxShadow = '0 0 30px oklch(0.65 0.16 240 / 0.3)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'oklch(0.65 0.16 240 / 0.08)'
              e.currentTarget.style.borderColor = 'oklch(0.65 0.16 240 / 0.5)'
              e.currentTarget.style.boxShadow = 'none'
            }}
          >
            Multiplayer
          </button>
        </div>

        <div className="mt-8 flex flex-col items-center gap-1 text-white/25 text-xs">
          <p className="hidden md:block">Click bacteria to modify their genome</p>
          <p className="md:hidden">Tap bacteria to modify their genome</p>
          <p className="hidden md:block">Scroll to zoom · Shift+drag to pan</p>
          <p className="md:hidden">Drag to interact · Two-finger pan &amp; pinch zoom</p>
        </div>
        <p className="mt-12 text-white/85 text-[12px] tracking-wide">
          Vibecoded together by Aric and Juniper
        </p>
      </div>
    </div>
  )
}

function App() {
  const [state, dispatch] = useReducer(gameReducer, initialState)
  const [screen, setScreen] = useState<AppScreen>(() => {
    // Auto-join if ?room= in URL
    const params = new URLSearchParams(window.location.search)
    return params.get('room') ? 'mp-lobby' : 'splash'
  })
  const [mpRoomCode, setMpRoomCode] = useState<string | undefined>(undefined)
  const [showStore, setShowStore] = useState(false)
  const tickRef = useRef<number>(0)
  const modPanelOpen = useRef(false)
  const mouseWorldRef = useRef({ x: 0, y: 0 })
  const showSplash = screen === 'splash'

  const selectedBacterium = state.selectedId
    ? state.bacteria.find(b => b.id === state.selectedId)
    : null

  // Sync equipped music with audio engine
  useEffect(() => {
    playMusic(state.store.equipped.music)
  }, [state.store.equipped.music])

  // Game tick loop (~30 tps)
  useEffect(() => {
    let lastTime = 0
    const TICK_INTERVAL = 1000 / 30

    const loop = (time: number) => {
      if (time - lastTime >= TICK_INTERVAL) {
        if (!state.paused && !modPanelOpen.current && !showSplash) {
          dispatch({ type: 'TICK', mouseX: mouseWorldRef.current.x, mouseY: mouseWorldRef.current.y })
        }
        lastTime = time
      }
      tickRef.current = requestAnimationFrame(loop)
    }

    tickRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(tickRef.current)
  }, [state.paused, showSplash])

  // Track mod panel open state
  useEffect(() => {
    modPanelOpen.current = state.selectedId !== null
  }, [state.selectedId])

  const handleCloseModPanel = useCallback(() => {
    dispatch({ type: 'SELECT', id: null })
  }, [])

  // Multiplayer flow handlers
  const handleMultiplayer = useCallback(() => setScreen('mp-lobby'), [])
  const handleCreateRoom = useCallback(() => {
    setMpRoomCode(undefined)
    setScreen('mp-game')
  }, [])
  const handleJoinRoom = useCallback((code: string) => {
    setMpRoomCode(code)
    setScreen('mp-game')
  }, [])
  const handleMpDisconnect = useCallback(() => {
    setMpRoomCode(undefined)
    // Clean room param from URL
    const url = new URL(window.location.href)
    url.searchParams.delete('room')
    window.history.replaceState({}, '', url.toString())
    setScreen('splash')
  }, [])

  if (screen === 'mp-lobby') {
    return <MultiplayerLobby onCreateRoom={handleCreateRoom} onJoinRoom={handleJoinRoom} onBack={() => setScreen('splash')} />
  }

  if (screen === 'mp-game') {
    return <MultiplayerGame roomCode={mpRoomCode} onDisconnect={handleMpDisconnect} />
  }

  return (
    <div className="relative w-full h-screen overflow-hidden bg-background">
      <PetriDish state={state} dispatch={dispatch} mouseWorldRef={mouseWorldRef} />
      <HUD state={state} dispatch={dispatch} onOpenStore={() => setShowStore(true)} />
      <EquipSidebar state={state} dispatch={dispatch} />
      {selectedBacterium && (
        <BacteriaModPanel
          bacterium={selectedBacterium}
          dispatch={dispatch}
          onClose={handleCloseModPanel}
        />
      )}
      {showStore && (
        <StorePanel
          state={state}
          dispatch={dispatch}
          onClose={() => setShowStore(false)}
        />
      )}
      {screen === 'splash' && <SplashScreen onPlay={() => setScreen('singleplayer')} onMultiplayer={handleMultiplayer} />}
    </div>
  )
}

export default App
