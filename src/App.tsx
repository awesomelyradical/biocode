import { useReducer, useEffect, useRef, useCallback, useState } from 'react'
import { PetriDish } from './components/PetriDish'
import { BacteriaModPanel } from './components/BacteriaModPanel'
import { StorePanel } from './components/StorePanel'
import { HUD } from './components/HUD'
import { gameReducer } from './gameReducer'
import { species, spawnInitialPopulation, WORLD_WIDTH, WORLD_HEIGHT } from './data'
import { playMusic } from './audio'
import type { GameState } from './types'

const initialState: GameState = {
  bacteria: spawnInitialPopulation(WORLD_WIDTH, WORLD_HEIGHT, 25),
  nutrients: [],
  species,
  camera: { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2, zoom: 0.5 },
  selectedId: null,
  tick: 0,
  worldWidth: WORLD_WIDTH,
  worldHeight: WORLD_HEIGHT,
  paused: false,
  biomass: 0,
  store: {
    unlocked: new Set(['bg-dark-void']),
    equipped: { colors: null, patterns: null, backgrounds: 'bg-dark-void', music: null },
  },
}

function SplashScreen({ onPlay }: { onPlay: () => void }) {
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

        <button
          onClick={handlePlay}
          className="group relative mt-4 px-12 py-4 rounded-full border-2 text-lg font-semibold tracking-wider uppercase transition-all duration-300 cursor-pointer hover:scale-105 active:scale-95"
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

        <div className="mt-8 flex flex-col items-center gap-1 text-white/25 text-xs">
          <p>Click bacteria to modify their genome</p>
          <p>Scroll to zoom · Shift+drag to pan</p>
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
  const [showSplash, setShowSplash] = useState(true)
  const [showStore, setShowStore] = useState(false)
  const tickRef = useRef<number>(0)
  const modPanelOpen = useRef(false)
  const mouseWorldRef = useRef({ x: 0, y: 0 })

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

  return (
    <div className="relative w-full h-screen overflow-hidden bg-background">
      <PetriDish state={state} dispatch={dispatch} mouseWorldRef={mouseWorldRef} />
      <HUD state={state} dispatch={dispatch} onOpenStore={() => setShowStore(true)} />
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
      {showSplash && <SplashScreen onPlay={() => setShowSplash(false)} />}
    </div>
  )
}

export default App
