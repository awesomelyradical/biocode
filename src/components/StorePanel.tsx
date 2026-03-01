/**
 * @module StorePanel
 *
 * Full-screen overlay for the cosmetic store where players spend biomass.
 *
 * Four category tabs: Colors, Patterns, Backgrounds, Music.
 * Each item card shows its cost, description, and a preview swatch (for colours
 * and backgrounds). Three purchase states: locked (buy), owned (equip), equipped
 * (unequip). The panel is responsive with animated mount/unmount transitions.
 */

import { useState, useEffect } from 'react'
import type { GameAction, GameState, StoreCategory } from '../types'
import { STORE_ITEMS } from '../data'

interface StorePanelProps {
  state: GameState
  dispatch: React.Dispatch<GameAction>
  onClose: () => void
}

const CATEGORIES: { key: StoreCategory; label: string; icon: string }[] = [
  { key: 'colors', label: 'Colors', icon: '🎨' },
  { key: 'patterns', label: 'Patterns', icon: '🌀' },
  { key: 'backgrounds', label: 'Backgrounds', icon: '🖼️' },
  { key: 'music', label: 'Music', icon: '🎵' },
]

export function StorePanel({ state, dispatch, onClose }: StorePanelProps) {
  const [isMounted, setIsMounted] = useState(false)
  const [activeCategory, setActiveCategory] = useState<StoreCategory>('colors')

  useEffect(() => {
    requestAnimationFrame(() => setIsMounted(true))
  }, [])

  const items = STORE_ITEMS.filter(i => i.category === activeCategory)
  const equippedId = state.store.equipped[activeCategory]

  return (
    <div
      className={`
        fixed inset-4 md:inset-10 z-50
        bg-card/90 backdrop-blur-xl
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
          <div className="text-2xl">🧬</div>
          <div>
            <h2 className="text-2xl md:text-3xl font-bold text-primary">Bio Store</h2>
            <p className="text-xs text-muted-foreground">
              Customize your petri dish
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-primary/10 border border-primary/30 rounded-full px-4 py-1.5">
            <span className="text-sm">🧫</span>
            <span className="text-sm font-bold text-primary font-mono">{Math.floor(state.biomass)}</span>
            <span className="text-[10px] text-muted-foreground">biomass</span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full border border-primary/30 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-primary/20 transition-colors cursor-pointer text-lg"
          >
            ×
          </button>
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 p-3 border-b border-primary/10">
        {CATEGORIES.map(cat => (
          <button
            key={cat.key}
            onClick={() => setActiveCategory(cat.key)}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer
              ${activeCategory === cat.key
                ? 'bg-primary/20 text-primary border border-primary/40'
                : 'text-muted-foreground hover:text-foreground hover:bg-card/80 border border-transparent'
              }
            `}
          >
            <span>{cat.icon}</span>
            <span>{cat.label}</span>
          </button>
        ))}
      </div>

      {/* Items grid */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map(item => {
            const owned = state.store.unlocked.has(item.id)
            const equipped = equippedId === item.id
            const canAfford = state.biomass >= item.cost

            return (
              <div
                key={item.id}
                className={`
                  relative rounded-xl border p-4 transition-all duration-200
                  ${equipped
                    ? 'border-primary/60 bg-primary/10 shadow-[0_0_20px_rgba(100,200,120,0.1)]'
                    : owned
                      ? 'border-primary/25 bg-card/60 hover:border-primary/40'
                      : 'border-primary/10 bg-card/40'
                  }
                `}
              >
                {/* Preview swatch */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-lg border border-white/10 flex items-center justify-center text-xl"
                      style={item.preview ? { backgroundColor: item.preview } : undefined}
                    >
                      {!item.preview && item.icon}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-foreground">{item.name}</div>
                      <div className="text-[11px] text-muted-foreground">{item.description}</div>
                    </div>
                  </div>
                  {equipped && (
                    <span className="text-[10px] font-bold text-primary bg-primary/20 px-2 py-0.5 rounded-full">
                      ACTIVE
                    </span>
                  )}
                </div>

                {/* Action */}
                <div className="flex items-center justify-between">
                  {!owned ? (
                    <button
                      onClick={() => dispatch({ type: 'BUY_ITEM', itemId: item.id })}
                      disabled={!canAfford}
                      className={`
                        text-xs font-semibold px-4 py-1.5 rounded-lg transition-all cursor-pointer
                        ${canAfford
                          ? 'bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30'
                          : 'bg-card/40 text-muted-foreground/50 border border-primary/10 cursor-not-allowed'
                        }
                      `}
                    >
                      🧫 {item.cost}
                    </button>
                  ) : equipped ? (
                    <button
                      onClick={() => dispatch({ type: 'UNEQUIP_ITEM', category: item.category })}
                      className="text-xs font-semibold px-4 py-1.5 rounded-lg bg-primary/15 text-primary/70 border border-primary/30 hover:bg-primary/25 transition-all cursor-pointer"
                    >
                      Unequip
                    </button>
                  ) : (
                    <button
                      onClick={() => dispatch({ type: 'EQUIP_ITEM', itemId: item.id, category: item.category })}
                      className="text-xs font-semibold px-4 py-1.5 rounded-lg bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 transition-all cursor-pointer"
                    >
                      Equip
                    </button>
                  )}

                  {owned && !equipped && (
                    <span className="text-[10px] text-muted-foreground/60">Owned</span>
                  )}
                  {!owned && !canAfford && (
                    <span className="text-[10px] text-muted-foreground/50">
                      Need {Math.ceil(item.cost - state.biomass)} more
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Footer hint */}
      <div className="p-3 border-t border-primary/10 text-center text-[10px] text-muted-foreground/40">
        Earn biomass by maintaining a thriving population
      </div>
    </div>
  )
}
