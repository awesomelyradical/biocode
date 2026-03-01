/**
 * @module PetriDish
 *
 * The main Canvas 2D renderer for the petri-dish simulation.
 *
 * Responsibilities:
 * - Renders bacteria with species-specific shapes (circle / rod / ellipse),
 *   animated flagella, energy rings, membrane glow, and movement-pattern effects.
 * - Draws floating nutrient particles with fade-out lifecycle.
 * - Handles all input: mouse (scroll-zoom, shift-drag pan, hover, click-select)
 *   and touch (one-finger cursor for attraction/repulsion, two-finger pan + pinch-zoom,
 *   tap-to-select).
 * - Draws a visible cursor dot on touch so mobile users can see their interaction point.
 * - Renders remote player cursors in multiplayer mode.
 * - Runs a `requestAnimationFrame` render loop scaled for devicePixelRatio.
 */

import { useRef, useEffect, useCallback } from 'react'
import type { GameState, GameAction, CameraState, BacteriaState } from '../types'
import { species, STORE_ITEMS } from '../data'

interface PetriDishProps {
  state: GameState
  dispatch: React.Dispatch<GameAction>
  remoteCursors?: Record<string, { x: number; y: number }>
}

// ── Rendering helpers ──

function drawBacterium(
  ctx: CanvasRenderingContext2D,
  b: BacteriaState,
  isSelected: boolean,
  isHovered: boolean,
) {
  const sp = species.find(s => s.id === b.speciesId)!
  const r = b.radius
  const color = b.properties.color || sp.color

  ctx.save()
  ctx.translate(b.x, b.y)
  ctx.rotate(b.angle)

  // Membrane glow (enhanced when hovered = "caught" by cursor)
  if (isSelected || isHovered) {
    // Outer soft glow
    const glowR = isHovered ? r + 14 : r + 6
    const glowGrad = ctx.createRadialGradient(0, 0, r, 0, 0, glowR)
    if (isHovered) {
      glowGrad.addColorStop(0, 'oklch(0.90 0.22 145 / 0.5)')
      glowGrad.addColorStop(0.5, 'oklch(0.85 0.18 145 / 0.25)')
      glowGrad.addColorStop(1, 'oklch(0.80 0.10 145 / 0)')
    } else {
      glowGrad.addColorStop(0, 'oklch(0.85 0.20 85 / 0.35)')
      glowGrad.addColorStop(1, 'oklch(0.85 0.20 85 / 0)')
    }
    ctx.beginPath()
    ctx.arc(0, 0, glowR, 0, Math.PI * 2)
    ctx.fillStyle = glowGrad
    ctx.fill()

    // Highlight ring
    ctx.beginPath()
    ctx.arc(0, 0, r + 3, 0, Math.PI * 2)
    ctx.strokeStyle = isHovered
      ? 'oklch(0.92 0.22 145 / 0.8)'
      : 'oklch(0.85 0.20 85 / 0.5)'
    ctx.lineWidth = isHovered ? 2 : 1.5
    ctx.stroke()
  }

  // Outer membrane
  ctx.beginPath()
  if (sp.shape === 'rod') {
    const hw = r * 1.8
    const hh = r * 0.7
    ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2)
  } else {
    ctx.arc(0, 0, r + 2, 0, Math.PI * 2)
  }
  const memColor = b.membraneColor ?? sp.membrane
  // Insert alpha into oklch color: oklch(L C H) → oklch(L C H / 0.3)
  ctx.fillStyle = memColor.replace(')', ' / 0.3)')
  ctx.fill()

  // Cell body
  ctx.beginPath()
  if (sp.shape === 'rod') {
    const hw = r * 1.6
    const hh = r * 0.6
    ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2)
  } else {
    ctx.arc(0, 0, r, 0, Math.PI * 2)
  }

  // Gradient fill
  const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r)
  grad.addColorStop(0, color.replace(')', ' / 0.9)').replace('oklch(', 'oklch('))
  grad.addColorStop(0.7, color)
  grad.addColorStop(1, color.replace(')', ' / 0.6)').replace('oklch(', 'oklch('))
  ctx.fillStyle = grad
  ctx.fill()

  // Nucleus
  ctx.beginPath()
  ctx.arc(r * 0.1, -r * 0.1, r * 0.25, 0, Math.PI * 2)
  ctx.fillStyle = 'oklch(0.3 0.05 0 / 0.3)'
  ctx.fill()

  // Flagella (animated trailing lines)
  const flagellaCount = sp.shape === 'rod' ? 1 : (sp.id === 'vibrio' ? 3 : 2)
  const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy)
  if (speed > 0.1) {
    ctx.strokeStyle = color.replace(')', ' / 0.4)').replace('oklch(', 'oklch(')
    ctx.lineWidth = 1.5
    for (let f = 0; f < flagellaCount; f++) {
      ctx.beginPath()
      const startAngle = Math.PI + (f - (flagellaCount - 1) / 2) * 0.4
      const startX = Math.cos(startAngle) * r
      const startY = Math.sin(startAngle) * r
      ctx.moveTo(startX, startY)

      const segments = 4
      const segLen = r * 0.5
      let cx = startX
      let cy = startY
      for (let s = 0; s < segments; s++) {
        const wave = Math.sin(b.flagellaPhase + s * 1.2 + f * 0.8) * r * 0.3
        cx += Math.cos(startAngle) * segLen
        cy += Math.sin(startAngle) * segLen + wave
        ctx.lineTo(cx, cy)
      }
      ctx.stroke()
    }
  }

  // Energy bar (small arc around the bacterium)
  const energyFrac = b.energy / 100
  ctx.beginPath()
  ctx.arc(0, 0, r + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * energyFrac)
  ctx.strokeStyle = energyFrac > 0.3
    ? 'oklch(0.75 0.20 145 / 0.6)'
    : 'oklch(0.65 0.25 25 / 0.8)'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // ── Movement pattern visual effects ──
  if (b.movementPattern) {
    const t = b.age * 0.05
    const memColor = b.membraneColor ?? sp.membrane

    switch (b.movementPattern) {
      case 'pattern-pulse': {
        // Pulsing ring overlay
        const pulseScale = 1 + Math.sin(t * 3) * 0.15
        ctx.beginPath()
        ctx.arc(0, 0, r * pulseScale + 6, 0, Math.PI * 2)
        ctx.strokeStyle = memColor.replace(')', ' / 0.2)')
        ctx.lineWidth = 2
        ctx.stroke()
        break
      }
      case 'pattern-trail': {
        // Fading dots behind the bacterium
        for (let i = 1; i <= 5; i++) {
          const trailAlpha = (0.25 - i * 0.04).toFixed(2)
          const tx = -Math.cos(b.angle) * r * i * 0.9
          const ty = -Math.sin(b.angle) * r * i * 0.9
          ctx.beginPath()
          ctx.arc(tx, ty, r * (0.35 - i * 0.04), 0, Math.PI * 2)
          ctx.fillStyle = memColor.replace(')', ` / ${trailAlpha})`)
          ctx.fill()
        }
        break
      }
      case 'pattern-orbit': {
        // Small orbiting particles
        for (let i = 0; i < 3; i++) {
          const orbitAngle = t * 3 + (i * Math.PI * 2) / 3
          const orbitR = r + 8
          const ox = Math.cos(orbitAngle) * orbitR
          const oy = Math.sin(orbitAngle) * orbitR
          ctx.beginPath()
          ctx.arc(ox, oy, 2.5, 0, Math.PI * 2)
          ctx.fillStyle = color.replace(')', ' / 0.7)')
          ctx.fill()
        }
        break
      }
      case 'pattern-spiral': {
        // Spiral trace overlay
        ctx.beginPath()
        ctx.strokeStyle = memColor.replace(')', ' / 0.15)')
        ctx.lineWidth = 1
        for (let a = 0; a < Math.PI * 4; a += 0.2) {
          const sr = r * 0.4 + a * 1.5
          const sx = Math.cos(a + t * 2) * sr
          const sy = Math.sin(a + t * 2) * sr
          if (a === 0) ctx.moveTo(sx, sy)
          else ctx.lineTo(sx, sy)
        }
        ctx.stroke()
        break
      }
      case 'pattern-zigzag': {
        // Small lightning bolt indicator
        ctx.beginPath()
        ctx.strokeStyle = 'oklch(0.85 0.20 85 / 0.4)'
        ctx.lineWidth = 1.5
        const zigOff = r + 6
        ctx.moveTo(zigOff, -4)
        ctx.lineTo(zigOff + 3, 0)
        ctx.lineTo(zigOff, 4)
        ctx.stroke()
        break
      }
    }
  }

  ctx.restore()
}

function drawWorld(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  worldW: number,
  worldH: number,
  gridColor = 'oklch(0.5 0.0 0 / 0.08)',
  borderColor = 'oklch(0.5 0.05 85 / 0.3)',
) {
  // Grid
  ctx.strokeStyle = gridColor
  ctx.lineWidth = 1
  const gridSize = 100
  for (let x = 0; x <= worldW; x += gridSize) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, worldH)
    ctx.stroke()
  }
  for (let y = 0; y <= worldH; y += gridSize) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(worldW, y)
    ctx.stroke()
  }

  // World border
  ctx.strokeStyle = borderColor
  ctx.lineWidth = 3
  ctx.strokeRect(0, 0, worldW, worldH)
}

// ── Component ──

export function PetriDish({ state, dispatch, mouseWorldRef, remoteCursors }: PetriDishProps & { mouseWorldRef: React.MutableRefObject<{ x: number; y: number }> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const animFrameRef = useRef<number>(0)
  const hoveredRef = useRef<string | null>(null)
  const mousePosRef = useRef({ x: 0, y: 0 })
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0, camX: 0, camY: 0 })

  // Touch state
  const touchActiveRef = useRef(false)
  const touchStateRef = useRef<{
    mode: 'none' | 'cursor' | 'pan'
    startTime: number
    startX: number
    startY: number
    lastDist: number
    lastMidX: number
    lastMidY: number
    moved: boolean
  }>({ mode: 'none', startTime: 0, startX: 0, startY: 0, lastDist: 0, lastMidX: 0, lastMidY: 0, moved: false })

  // Convert screen coords (device pixels) to world coords
  const screenToWorld = useCallback((screenX: number, screenY: number, camera: CameraState) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const dpr = devicePixelRatio
    return {
      x: (screenX - canvas.width / 2) / (camera.zoom * dpr) + camera.x,
      y: (screenY - canvas.height / 2) / (camera.zoom * dpr) + camera.y,
    }
  }, [])

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      const rect = container.getBoundingClientRect()
      canvas.width = rect.width * devicePixelRatio
      canvas.height = rect.height * devicePixelRatio
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
    }
    resize()

    const render = () => {
      const { camera, bacteria, nutrients, selectedId, worldWidth, worldHeight } = state

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Background
      const bgItemId = state.store.equipped.backgrounds
      const bgItem = bgItemId ? STORE_ITEMS.find(i => i.id === bgItemId) : null
      const bgColor = bgItem?.preview ?? 'oklch(0.12 0.02 240)'

      if (bgItemId === 'bg-aurora') {
        // Gradient background for aurora
        const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
        grad.addColorStop(0, 'oklch(0.10 0.06 280)')
        grad.addColorStop(0.3, 'oklch(0.14 0.05 180)')
        grad.addColorStop(0.6, 'oklch(0.12 0.07 145)')
        grad.addColorStop(1, 'oklch(0.10 0.04 280)')
        ctx.fillStyle = grad
      } else {
        ctx.fillStyle = bgColor
      }
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // Apply camera transform
      const dpr = devicePixelRatio
      ctx.setTransform(
        camera.zoom * dpr, 0, 0, camera.zoom * dpr,
        (canvas.width / 2 - camera.x * camera.zoom * dpr),
        (canvas.height / 2 - camera.y * camera.zoom * dpr),
      )

      drawWorld(ctx, canvas.width, canvas.height, worldWidth, worldHeight)

      // Draw bacteria (back to front, larger ones first for z-sorting)
      const sorted = [...bacteria].sort((a, b) => b.radius - a.radius)
      for (const b of sorted) {
        drawBacterium(ctx, b, b.id === selectedId, b.id === hoveredRef.current)
      }

      // Draw nutrient particles
      for (const n of nutrients) {
        const fade = 1 - n.age / n.maxAge
        const alpha = Math.min(1, fade * 1.5) // fade out in last third of life
        ctx.save()
        ctx.globalAlpha = alpha * 0.85

        // Glow
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.radius * 2.5, 0, Math.PI * 2)
        ctx.fillStyle = n.color
        ctx.globalAlpha = alpha * 0.15
        ctx.fill()

        // Core
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2)
        ctx.fillStyle = n.color
        ctx.globalAlpha = alpha * 0.85
        ctx.fill()

        // Bright center
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.radius * 0.4, 0, Math.PI * 2)
        ctx.fillStyle = '#ffffff'
        ctx.globalAlpha = alpha * 0.6
        ctx.fill()

        ctx.restore()
      }

      // Draw species label on hover
      if (hoveredRef.current) {
        const hb = bacteria.find(b => b.id === hoveredRef.current)
        if (hb) {
          const sp = species.find(s => s.id === hb.speciesId)!
          ctx.save()
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          const screenPos = {
            x: (hb.x - camera.x) * camera.zoom + canvas.width / (2 * dpr),
            y: (hb.y - camera.y) * camera.zoom + canvas.height / (2 * dpr),
          }
          ctx.font = '12px "Space Grotesk", sans-serif'
          ctx.fillStyle = 'oklch(0.9 0.0 0 / 0.9)'
          ctx.textAlign = 'center'
          ctx.fillText(sp.name, screenPos.x, screenPos.y - hb.radius * camera.zoom - 10)
          ctx.restore()
        }
      }

      // Draw local touch cursor dot
      if (touchActiveRef.current) {
        const mw = mouseWorldRef.current
        if (mw.x !== 0 || mw.y !== 0) {
          ctx.save()
          // Pulsing glow
          const pulse = 0.6 + Math.sin(performance.now() / 200) * 0.2
          const grad = ctx.createRadialGradient(mw.x, mw.y, 0, mw.x, mw.y, 18)
          grad.addColorStop(0, `oklch(0.85 0.20 145 / ${pulse})`)
          grad.addColorStop(0.5, `oklch(0.75 0.18 145 / ${pulse * 0.3})`)
          grad.addColorStop(1, 'transparent')
          ctx.fillStyle = grad
          ctx.beginPath()
          ctx.arc(mw.x, mw.y, 18, 0, Math.PI * 2)
          ctx.fill()

          // Solid dot
          ctx.beginPath()
          ctx.arc(mw.x, mw.y, 4, 0, Math.PI * 2)
          ctx.fillStyle = 'oklch(0.90 0.18 145)'
          ctx.fill()
          ctx.strokeStyle = 'oklch(0.95 0.10 145 / 0.8)'
          ctx.lineWidth = 1.5
          ctx.stroke()
          ctx.restore()
        }
      }

      // Draw remote player cursors
      if (remoteCursors) {
        const cursorColors = [
          'oklch(0.80 0.22 350)', 'oklch(0.75 0.20 200)',
          'oklch(0.80 0.20 85)', 'oklch(0.70 0.22 280)',
          'oklch(0.78 0.18 145)', 'oklch(0.75 0.20 30)',
        ]
        let ci = 0
        for (const [, pos] of Object.entries(remoteCursors)) {
          if (pos.x === 0 && pos.y === 0) continue
          const color = cursorColors[ci % cursorColors.length]
          ci++

          // Draw a small circle + cross at cursor position (world coords, already transformed)
          ctx.save()
          ctx.beginPath()
          ctx.arc(pos.x, pos.y, 6, 0, Math.PI * 2)
          ctx.fillStyle = color.replace(')', ' / 0.4)')
          ctx.fill()
          ctx.strokeStyle = color
          ctx.lineWidth = 1.5
          ctx.stroke()

          // Crosshair lines
          ctx.beginPath()
          ctx.moveTo(pos.x - 10, pos.y)
          ctx.lineTo(pos.x + 10, pos.y)
          ctx.moveTo(pos.x, pos.y - 10)
          ctx.lineTo(pos.x, pos.y + 10)
          ctx.strokeStyle = color.replace(')', ' / 0.6)')
          ctx.lineWidth = 1
          ctx.stroke()
          ctx.restore()
        }
      }

      animFrameRef.current = requestAnimationFrame(render)
    }

    animFrameRef.current = requestAnimationFrame(render)
    window.addEventListener('resize', resize)

    return () => {
      cancelAnimationFrame(animFrameRef.current)
      window.removeEventListener('resize', resize)
    }
  }, [state, screenToWorld, remoteCursors])

  // ── Event Handlers ──

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const screenX = e.clientX - rect.left
    const screenY = e.clientY - rect.top

    // World position under cursor before zoom
    const worldX = (screenX - rect.width / 2) / state.camera.zoom + state.camera.x
    const worldY = (screenY - rect.height / 2) / state.camera.zoom + state.camera.y

    const delta = -e.deltaY * 0.001
    const newZoom = Math.max(0.15, Math.min(5, state.camera.zoom + delta * state.camera.zoom))

    // Adjust camera so the same world point stays under the cursor
    const newX = worldX - (screenX - rect.width / 2) / newZoom
    const newY = worldY - (screenY - rect.height / 2) / newZoom

    dispatch({ type: 'SET_CAMERA', camera: { zoom: newZoom, x: newX, y: newY } })
  }, [state.camera.zoom, state.camera.x, state.camera.y, dispatch])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const screenX = e.clientX - rect.left
    const screenY = e.clientY - rect.top
    mousePosRef.current = { x: screenX, y: screenY }

    if (isDraggingRef.current) {
      const dx = (e.clientX - dragStartRef.current.x) / state.camera.zoom
      const dy = (e.clientY - dragStartRef.current.y) / state.camera.zoom
      dispatch({
        type: 'SET_CAMERA',
        camera: {
          x: dragStartRef.current.camX - dx,
          y: dragStartRef.current.camY - dy,
        },
      })
      return
    }

    // Hover detection + update world-space mouse position for physics
    const world = screenToWorld(screenX * devicePixelRatio, screenY * devicePixelRatio, state.camera)
    mouseWorldRef.current = world
    let found: string | null = null
    for (const b of state.bacteria) {
      const dx = world.x - b.x
      const dy = world.y - b.y
      if (Math.sqrt(dx * dx + dy * dy) < b.radius) {
        found = b.id
        break
      }
    }
    hoveredRef.current = found
  }, [state.camera, state.bacteria, screenToWorld, dispatch])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      // Middle click or shift+click = pan
      isDraggingRef.current = true
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        camX: state.camera.x,
        camY: state.camera.y,
      }
      e.preventDefault()
    }
  }, [state.camera])

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false
  }, [])

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (isDraggingRef.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const screenX = (e.clientX - rect.left) * devicePixelRatio
    const screenY = (e.clientY - rect.top) * devicePixelRatio
    const world = screenToWorld(screenX, screenY, state.camera)

    // Hit test bacteria
    for (const b of state.bacteria) {
      const dx = world.x - b.x
      const dy = world.y - b.y
      if (Math.sqrt(dx * dx + dy * dy) < b.radius) {
        dispatch({ type: 'SELECT', id: b.id })
        return
      }
    }
    // Click on empty space deselects
    dispatch({ type: 'SELECT', id: null })
  }, [state.camera, state.bacteria, screenToWorld, dispatch])

  // ── Touch Handlers ──

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    const ts = touchStateRef.current

    if (e.touches.length === 1) {
      // Single finger = cursor mode (attraction / repulsion / catch)
      const t = e.touches[0]
      ts.mode = 'cursor'
      ts.startTime = Date.now()
      ts.startX = t.clientX
      ts.startY = t.clientY
      ts.moved = false
      touchActiveRef.current = true

      // Immediately place the cursor in world space
      const canvas = canvasRef.current
      if (canvas) {
        const rect = canvas.getBoundingClientRect()
        const screenX = (t.clientX - rect.left) * devicePixelRatio
        const screenY = (t.clientY - rect.top) * devicePixelRatio
        mouseWorldRef.current = screenToWorld(screenX, screenY, state.camera)
      }
    } else if (e.touches.length === 2) {
      // Two fingers = pan + pinch-to-zoom
      ts.mode = 'pan'
      ts.moved = true // prevent tap-select when lifting second finger
      touchActiveRef.current = false
      mouseWorldRef.current = { x: 0, y: 0 } // disable cursor physics while panning

      const [a, b] = [e.touches[0], e.touches[1]]
      ts.lastDist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY)
      ts.lastMidX = (a.clientX + b.clientX) / 2
      ts.lastMidY = (a.clientY + b.clientY) / 2
      dragStartRef.current = {
        x: ts.lastMidX,
        y: ts.lastMidY,
        camX: state.camera.x,
        camY: state.camera.y,
      }
    }
  }, [state.camera, screenToWorld])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    const ts = touchStateRef.current

    if (ts.mode === 'cursor' && e.touches.length === 1) {
      // Single finger drag — move the cursor dot
      const t = e.touches[0]
      const dx = t.clientX - ts.startX
      const dy = t.clientY - ts.startY
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) ts.moved = true

      const canvas = canvasRef.current
      if (canvas) {
        const rect = canvas.getBoundingClientRect()
        const screenX = (t.clientX - rect.left) * devicePixelRatio
        const screenY = (t.clientY - rect.top) * devicePixelRatio
        mouseWorldRef.current = screenToWorld(screenX, screenY, state.camera)
      }
    } else if (ts.mode === 'pan' && e.touches.length === 2) {
      // Two-finger drag — pan + pinch zoom
      const [a, b] = [e.touches[0], e.touches[1]]
      const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY)
      const midX = (a.clientX + b.clientX) / 2
      const midY = (a.clientY + b.clientY) / 2

      // Zoom
      const scale = dist / ts.lastDist
      const newZoom = Math.max(0.15, Math.min(5, state.camera.zoom * scale))

      // Pan
      const panDx = (midX - dragStartRef.current.x) / state.camera.zoom
      const panDy = (midY - dragStartRef.current.y) / state.camera.zoom

      dispatch({
        type: 'SET_CAMERA',
        camera: {
          zoom: newZoom,
          x: dragStartRef.current.camX - panDx,
          y: dragStartRef.current.camY - panDy,
        },
      })

      ts.lastDist = dist
      ts.lastMidX = midX
      ts.lastMidY = midY
      dragStartRef.current = {
        x: midX,
        y: midY,
        camX: state.camera.x,
        camY: state.camera.y,
      }
    }
  }, [state.camera, dispatch, screenToWorld])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    const ts = touchStateRef.current

    // Tap to select (short touch, didn't move much)
    if (ts.mode === 'cursor' && !ts.moved && Date.now() - ts.startTime < 300) {
      const canvas = canvasRef.current
      if (canvas) {
        const rect = canvas.getBoundingClientRect()
        const screenX = (ts.startX - rect.left) * devicePixelRatio
        const screenY = (ts.startY - rect.top) * devicePixelRatio
        const world = screenToWorld(screenX, screenY, state.camera)

        let found = false
        for (const b of state.bacteria) {
          const dx = world.x - b.x
          const dy = world.y - b.y
          if (Math.sqrt(dx * dx + dy * dy) < b.radius * 1.5) {
            dispatch({ type: 'SELECT', id: b.id })
            found = true
            break
          }
        }
        if (!found) dispatch({ type: 'SELECT', id: null })
      }
    }

    if (e.touches.length === 0) {
      // All fingers lifted — clear cursor
      ts.mode = 'none'
      touchActiveRef.current = false
      mouseWorldRef.current = { x: 0, y: 0 }
    } else if (e.touches.length === 1 && ts.mode === 'pan') {
      // Went from two fingers to one — switch to cursor mode
      ts.mode = 'cursor'
      ts.moved = true // don't trigger tap
      touchActiveRef.current = true
      const t = e.touches[0]
      const canvas = canvasRef.current
      if (canvas) {
        const rect = canvas.getBoundingClientRect()
        const screenX = (t.clientX - rect.left) * devicePixelRatio
        const screenY = (t.clientY - rect.top) * devicePixelRatio
        mouseWorldRef.current = screenToWorld(screenX, screenY, state.camera)
      }
    }
  }, [state.camera, state.bacteria, screenToWorld, dispatch])

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden"
      style={{ cursor: isDraggingRef.current ? 'grabbing' : (hoveredRef.current ? 'pointer' : 'default') }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ touchAction: 'none' }}
        onWheel={handleWheel}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />
    </div>
  )
}
