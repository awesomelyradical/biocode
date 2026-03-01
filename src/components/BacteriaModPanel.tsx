/**
 * @module BacteriaModPanel
 *
 * Full-screen overlay panel for modifying a selected bacterium's genome.
 *
 * Features:
 * - Canvas-based radial ring chart showing the distribution of plasmid trait points
 *   as colour-coded pie segments.
 * - Click a segment to select it; use the scroll wheel (or buttons) to redistribute
 *   trait points from other traits into the selected one.
 * - Behavior sliders for kinAffinity, xenoAffinity, lifeFecundity, aggression,
 *   and permeability.
 * - Displays energy, age, plasmid capacity, and a "Split" button for manual fission.
 * - Responsive (inset-4 on mobile, inset-10 on desktop) with entry/exit animations.
 */

import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { Button } from './ui/button'
import type { BacteriaState, GameAction, TraitKey, BehaviorKey } from '../types'
import { species, TRAIT_KEYS, TRAIT_CONFIGS, BASE_TRAIT_POINTS, BEHAVIOR_KEYS, BEHAVIOR_CONFIGS } from '../data'

interface BacteriaModPanelProps {
  bacterium: BacteriaState
  dispatch: React.Dispatch<GameAction>
  onClose: () => void
}

const GAP_ANGLE = 0.04 // radians between segments
const TWO_PI = Math.PI * 2

function getSegmentAtAngle(
  angle: number,
  traits: Record<TraitKey, number>,
  capacity: number,
): TraitKey | null {
  let cursor = -Math.PI / 2
  for (const key of TRAIT_KEYS) {
    const sweep = (traits[key] / capacity) * TWO_PI - GAP_ANGLE
    if (sweep <= 0) { cursor += GAP_ANGLE; continue }
    const start = cursor + GAP_ANGLE / 2
    const end = start + sweep
    // Normalize angle to same range
    let a = angle
    while (a < start - 0.01) a += TWO_PI
    while (a > start + TWO_PI) a -= TWO_PI
    if (a >= start && a <= end) return key
    cursor = end + GAP_ANGLE / 2
  }
  return null
}

export function BacteriaModPanel({ bacterium, dispatch, onClose }: BacteriaModPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number>(0)
  const [isMounted, setIsMounted] = useState(false)
  const [selectedTrait, setSelectedTrait] = useState<TraitKey | null>(null)
  const pulseRef = useRef(0)

  const sp = useMemo(() => species.find(s => s.id === bacterium.speciesId)!, [bacterium.speciesId])

  useEffect(() => {
    requestAnimationFrame(() => setIsMounted(true))
  }, [])

  const adjustTrait = useCallback((trait: TraitKey, delta: number) => {
    dispatch({ type: 'ADJUST_TRAIT', id: bacterium.id, trait, delta })
  }, [dispatch, bacterium.id])

  // Canvas ring chart
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      const cx = rect.width / 2
      const cy = rect.height / 2
      const mx = e.clientX - rect.left - cx
      const my = e.clientY - rect.top - cy
      const dist = Math.sqrt(mx * mx + my * my)
      const ringR = Math.min(cx, cy) * 0.55
      const bandWidth = Math.min(cx, cy) * 0.18

      if (dist > ringR - bandWidth && dist < ringR + bandWidth) {
        const angle = Math.atan2(my, mx)
        const hit = getSegmentAtAngle(angle, bacterium.plasmid.traits, bacterium.plasmid.capacity)
        setSelectedTrait(hit)
      } else {
        setSelectedTrait(null)
      }
    }

    const handleWheel = (e: WheelEvent) => {
      if (!selectedTrait) return
      e.preventDefault()
      const delta = e.deltaY < 0 ? 1 : -1
      dispatch({ type: 'ADJUST_TRAIT', id: bacterium.id, trait: selectedTrait, delta })
    }

    canvas.addEventListener('click', handleClick)
    canvas.addEventListener('wheel', handleWheel, { passive: false })

    const draw = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const w = rect.width
      const h = rect.height
      const cx = w / 2
      const cy = h / 2
      const ringR = Math.min(cx, cy) * 0.55
      const bandWidth = Math.min(cx, cy) * 0.16
      const innerR = ringR - bandWidth / 2
      const outerR = ringR + bandWidth / 2

      ctx.clearRect(0, 0, w, h)

      pulseRef.current += 0.03
      const pulse = 0.5 + Math.sin(pulseRef.current) * 0.5

      // Draw ring segments
      let cursor = -Math.PI / 2
      for (const key of TRAIT_KEYS) {
        const frac = bacterium.plasmid.traits[key] / bacterium.plasmid.capacity
        const sweep = frac * TWO_PI - GAP_ANGLE
        if (sweep <= 0) { cursor += GAP_ANGLE; continue }
        const startAngle = cursor + GAP_ANGLE / 2
        const endAngle = startAngle + sweep
        const isSelected = key === selectedTrait

        const cfg = TRAIT_CONFIGS[key]

        // Segment fill
        const selInner = isSelected ? innerR - 6 : innerR
        const selOuter = isSelected ? outerR + 6 : outerR
        ctx.beginPath()
        ctx.arc(cx, cy, selOuter, startAngle, endAngle)
        ctx.arc(cx, cy, selInner, endAngle, startAngle, true)
        ctx.closePath()

        // Gradient fill along the arc
        ctx.fillStyle = cfg.color
        ctx.globalAlpha = isSelected ? 0.85 + pulse * 0.15 : 0.65
        ctx.fill()

        // Glow for selected
        if (isSelected) {
          ctx.save()
          ctx.shadowColor = cfg.color
          ctx.shadowBlur = 18
          ctx.beginPath()
          ctx.arc(cx, cy, selOuter + 2, startAngle, endAngle)
          ctx.arc(cx, cy, selInner - 2, endAngle, startAngle, true)
          ctx.closePath()
          ctx.fillStyle = cfg.color
          ctx.globalAlpha = 0.3
          ctx.fill()
          ctx.restore()
        }

        ctx.globalAlpha = 1

        // Segment border
        ctx.beginPath()
        ctx.arc(cx, cy, selOuter, startAngle, endAngle)
        ctx.arc(cx, cy, selInner, endAngle, startAngle, true)
        ctx.closePath()
        ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(255,255,255,0.15)'
        ctx.lineWidth = isSelected ? 2 : 1
        ctx.stroke()

        // Label
        const midAngle = (startAngle + endAngle) / 2
        const labelR = outerR + (isSelected ? 24 : 18)
        const lx = cx + Math.cos(midAngle) * labelR
        const ly = cy + Math.sin(midAngle) * labelR
        const multiplier = bacterium.plasmid.traits[key] / BASE_TRAIT_POINTS

        ctx.font = isSelected ? 'bold 13px "Space Grotesk", sans-serif' : '11px "Space Grotesk", sans-serif'
        ctx.fillStyle = isSelected ? '#ffffff' : 'rgba(255,255,255,0.7)'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(cfg.label, lx, ly - 7)

        ctx.font = '10px "Space Grotesk", sans-serif'
        ctx.fillStyle = isSelected ? cfg.color : 'rgba(255,255,255,0.45)'
        ctx.fillText(`${multiplier.toFixed(1)}x`, lx, ly + 7)

        // Percentage inside the ring
        if (frac > 0.06) {
          const inLabelR = ringR
          const ix = cx + Math.cos(midAngle) * inLabelR
          const iy = cy + Math.sin(midAngle) * inLabelR
          ctx.font = 'bold 10px "Space Grotesk", sans-serif'
          ctx.fillStyle = 'rgba(0,0,0,0.7)'
          ctx.fillText(`${(frac * 100).toFixed(0)}%`, ix, iy)
        }

        cursor = endAngle + GAP_ANGLE / 2
      }

      // Center info
      ctx.font = 'bold 16px "Space Grotesk", sans-serif'
      ctx.fillStyle = sp.color
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(sp.name, cx, cy - 14)

      ctx.font = '12px "Space Grotesk", sans-serif'
      ctx.fillStyle = 'rgba(255,255,255,0.6)'
      ctx.fillText(`Plasmid: ${bacterium.plasmid.capacity.toFixed(0)} pts`, cx, cy + 6)

      ctx.font = '10px "Space Grotesk", sans-serif'
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      ctx.fillText('click segment · scroll to adjust', cx, cy + 24)

      animationRef.current = requestAnimationFrame(draw)
    }

    animationRef.current = requestAnimationFrame(draw)

    return () => {
      canvas.removeEventListener('click', handleClick)
      canvas.removeEventListener('wheel', handleWheel)
      cancelAnimationFrame(animationRef.current)
    }
  }, [bacterium, selectedTrait, sp, dispatch])

  const selectedCfg = selectedTrait ? TRAIT_CONFIGS[selectedTrait] : null
  const selectedPts = selectedTrait ? bacterium.plasmid.traits[selectedTrait] : 0
  const selectedMult = selectedPts / BASE_TRAIT_POINTS

  return (
    <div
      className={`
        fixed inset-4 md:inset-10 z-50
        bg-card/85 backdrop-blur-xl
        border border-primary/30 rounded-2xl
        shadow-[0_0_50px_rgba(100,200,120,0.15)]
        flex flex-col
        transition-all duration-500 ease-out origin-center
        ${isMounted ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 md:p-6 border-b border-primary/20">
        <div className="flex items-center gap-4">
          <div
            className="w-8 h-8 rounded-full border-2"
            style={{
              backgroundColor: bacterium.properties.color,
              borderColor: sp.membrane,
            }}
          />
          <div>
            <h2 className="text-2xl md:text-3xl font-bold text-primary">{sp.name}</h2>
            <p className="text-xs text-muted-foreground">
              Energy: {bacterium.energy.toFixed(0)}% · Age: {bacterium.age} · Plasmid: {bacterium.plasmid.capacity.toFixed(0)} pts
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => dispatch({ type: 'REPRODUCE', parentId: bacterium.id })}
            disabled={bacterium.energy < 40}
            className="border-primary/50 text-primary hover:bg-primary/20 text-xs"
          >
            Split ({bacterium.energy < 40 ? 'low energy' : '-40 energy'})
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setIsMounted(false)
              setTimeout(onClose, 300)
            }}
            className="border-primary/50 hover:bg-primary hover:text-primary-foreground"
          >
            Close
          </Button>
        </div>
      </div>

      {/* Description */}
      <div className="px-4 md:px-6 py-2 text-sm text-muted-foreground border-b border-primary/10">
        {sp.description}
        <span className="ml-2 text-xs opacity-60">Click a gene segment, scroll to adjust. Traits share a point pool.</span>
      </div>

      {/* Ring chart + controls */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Canvas ring */}
        <div className="flex-1 relative min-h-0">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
            style={{ cursor: 'pointer' }}
          />
        </div>

        {/* Trait adjustment sidebar */}
        <div className="w-full md:w-64 border-t md:border-t-0 md:border-l border-primary/10 p-4 flex flex-col gap-2 overflow-y-auto">
          <div className="text-xs font-semibold text-primary mb-1">Gene Segments</div>
          {TRAIT_KEYS.map(key => {
            const cfg = TRAIT_CONFIGS[key]
            const pts = bacterium.plasmid.traits[key]
            const mult = pts / BASE_TRAIT_POINTS
            const isSelected = key === selectedTrait
            return (
              <div
                key={key}
                className={`
                  flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors
                  ${isSelected ? 'bg-primary/15 border border-primary/40' : 'hover:bg-primary/5 border border-transparent'}
                `}
                onClick={() => setSelectedTrait(isSelected ? null : key)}
              >
                <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: cfg.color }} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-foreground">{cfg.label}</div>
                  <div className="text-[10px] text-muted-foreground">{cfg.description}</div>
                </div>
                <div className="text-xs font-mono text-foreground/70">{mult.toFixed(1)}x</div>
              </div>
            )
          })}

          {/* Selected trait controls */}
          {selectedTrait && selectedCfg && (
            <div className="mt-3 p-3 bg-primary/5 border border-primary/20 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold" style={{ color: selectedCfg.color }}>{selectedCfg.label}</span>
                <span className="text-sm font-mono text-foreground">{selectedMult.toFixed(2)}x</span>
              </div>
              <div className="text-[10px] text-muted-foreground mb-2">
                {selectedPts.toFixed(1)} / {bacterium.plasmid.capacity.toFixed(0)} pts
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => adjustTrait(selectedTrait, -2)}
                  className="border-primary/40 text-primary hover:bg-primary/20 text-xs px-3"
                >
                  −2
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => adjustTrait(selectedTrait, -1)}
                  className="border-primary/40 text-primary hover:bg-primary/20 text-xs px-3"
                >
                  −1
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => adjustTrait(selectedTrait, 1)}
                  className="border-primary/40 text-primary hover:bg-primary/20 text-xs px-3"
                >
                  +1
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => adjustTrait(selectedTrait, 2)}
                  className="border-primary/40 text-primary hover:bg-primary/20 text-xs px-3"
                >
                  +2
                </Button>
              </div>
              <div className="text-[10px] text-muted-foreground/60 mt-2">
                Points taken from other traits proportionally
              </div>
            </div>
          )}

          {/* Behavior sliders — independent of plasmid */}
          <div className="mt-4 pt-3 border-t border-primary/10">
            <div className="text-xs font-semibold text-primary mb-2">Behavior</div>
            {BEHAVIOR_KEYS.map(key => {
              const cfg = BEHAVIOR_CONFIGS[key]
              const val = bacterium.behavior[key]
              return (
                <div key={key} className="mb-3">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[11px] font-medium text-foreground">{cfg.label}</span>
                    <span className="text-[10px] font-mono text-foreground/60">
                      {val > 0 ? '+' : ''}{val.toFixed(1)}
                    </span>
                  </div>
                  <div className="text-[9px] text-muted-foreground/60 mb-1">{cfg.description}</div>
                  <input
                    type="range"
                    min={cfg.min}
                    max={cfg.max}
                    step={cfg.step}
                    value={val}
                    onChange={e => dispatch({
                      type: 'SET_BEHAVIOR',
                      id: bacterium.id,
                      key,
                      value: parseFloat(e.target.value),
                    })}
                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, ${cfg.color}44, ${cfg.color})`,
                      accentColor: cfg.color,
                    }}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
