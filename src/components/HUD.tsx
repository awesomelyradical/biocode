import type { GameState, GameAction } from '../types'
import { species } from '../data'

interface HUDProps {
  state: GameState
  dispatch: React.Dispatch<GameAction>
  onOpenStore: () => void
}

export function HUD({ state, dispatch, onOpenStore }: HUDProps) {
  // Population counts per species
  const counts = new Map<string, number>()
  for (const b of state.bacteria) {
    counts.set(b.speciesId, (counts.get(b.speciesId) || 0) + 1)
  }

  const selectedBacterium = state.selectedId
    ? state.bacteria.find(b => b.id === state.selectedId)
    : null

  return (
    <>
      {/* Population panel — top left */}
      <div className="absolute top-3 left-3 z-30 bg-card/70 backdrop-blur-md border border-primary/20 rounded-lg px-3 py-2 pointer-events-none">
        <div className="text-xs font-semibold text-primary mb-1">Population ({state.bacteria.length})</div>
        <div className="flex flex-col gap-0.5">
          {species.map(sp => {
            const count = counts.get(sp.id) || 0
            if (count === 0) return null
            return (
              <div key={sp.id} className="flex items-center gap-2 text-xs">
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: sp.color }}
                />
                <span className="text-foreground/80 font-medium w-20">{sp.name}</span>
                <span className="text-muted-foreground font-mono">{count}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Zoom indicator — top right */}
      <div className="absolute top-3 right-3 z-30 bg-card/70 backdrop-blur-md border border-primary/20 rounded-lg px-3 py-2 pointer-events-none">
        <div className="text-xs text-muted-foreground">
          Zoom: {(state.camera.zoom * 100).toFixed(0)}%
        </div>
        <div className="text-[10px] text-muted-foreground/60 mt-0.5">
          Scroll to zoom · Shift+drag to pan
        </div>
      </div>

      {/* Selected bacterium info — bottom left */}
      {selectedBacterium && (
        <div className="absolute bottom-3 left-3 z-30 bg-card/70 backdrop-blur-md border border-primary/20 rounded-lg px-3 py-2 pointer-events-none">
          <div className="flex items-center gap-2 mb-1">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: selectedBacterium.properties.color }}
            />
            <span className="text-xs font-semibold text-primary">
              {species.find(s => s.id === selectedBacterium.speciesId)?.name} — Selected
            </span>
          </div>
          <div className="grid grid-cols-3 gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
            <span>Speed: {selectedBacterium.properties.speed.toFixed(2)}x</span>
            <span>Size: {selectedBacterium.properties.size.toFixed(2)}x</span>
            <span>Sense: {selectedBacterium.properties.senseRadius.toFixed(2)}x</span>
            <span>Bounce: {selectedBacterium.properties.restitution.toFixed(2)}x</span>
            <span>Drag: {selectedBacterium.properties.friction.toFixed(2)}x</span>
            <span>Repro: {selectedBacterium.properties.reproductionRate.toFixed(2)}x</span>
          </div>
          <div className="text-[10px] text-primary/60 mt-1">Click to open mod panel</div>
        </div>
      )}

      {/* Restart + Store + Game title — bottom right */}
      <div className="absolute bottom-3 right-3 z-30 flex items-center gap-3">
        <div className="flex items-center gap-1.5 bg-card/70 backdrop-blur-md border border-primary/20 rounded-lg px-3 py-1.5 pointer-events-none">
          <span className="text-sm">🧫</span>
          <span className="text-xs font-bold text-primary font-mono">{Math.floor(state.biomass)}</span>
        </div>
        <button
          onClick={onOpenStore}
          className="bg-card/70 backdrop-blur-md border border-primary/20 rounded-lg px-3 py-1.5 text-xs text-primary hover:bg-primary/20 transition-colors cursor-pointer flex items-center gap-1.5"
        >
          <span>🧬</span> Store
        </button>
        <button
          onClick={() => dispatch({ type: 'RESTART' })}
          className="bg-card/70 backdrop-blur-md border border-primary/20 rounded-lg px-3 py-1.5 text-xs text-primary hover:bg-primary/20 transition-colors cursor-pointer"
        >
          Restart
        </button>
        <span className="text-xs font-bold text-primary/30 tracking-widest pointer-events-none">BIOCODE</span>
      </div>
    </>
  )
}
