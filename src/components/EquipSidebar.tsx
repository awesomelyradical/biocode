import { useState } from 'react'
import type { GameState, GameAction, StoreCategory, NutrientProfileId } from '../types'
import { STORE_ITEMS, NUTRIENT_PROFILES } from '../data'

interface EquipSidebarProps {
  state: GameState
  dispatch: React.Dispatch<GameAction>
}

const CATEGORIES: { key: StoreCategory; icon: string; label: string }[] = [
  { key: 'colors', icon: '🎨', label: 'Colors' },
  { key: 'patterns', icon: '🌀', label: 'Patterns' },
  { key: 'backgrounds', icon: '🖼️', label: 'Backgrounds' },
  { key: 'music', icon: '🎵', label: 'Music' },
  { key: 'tools', icon: '🧪', label: 'Tools' },
]

export function EquipSidebar({ state, dispatch }: EquipSidebarProps) {
  const [openCategory, setOpenCategory] = useState<StoreCategory | null>(null)
  const [showPlateType, setShowPlateType] = useState(false)

  const toggle = (key: StoreCategory) => {
    setShowPlateType(false)
    setOpenCategory(prev => (prev === key ? null : key))
  }

  const togglePlateType = () => {
    setOpenCategory(null)
    setShowPlateType(prev => !prev)
  }

  return (
    <div className="absolute left-3 top-1/2 -translate-y-1/2 z-40 flex items-start gap-1.5">
      {/* Category icon strip */}
      <div className="flex flex-col gap-1.5">
        {/* Plate type selector */}
        <button
          onClick={togglePlateType}
          title="Plate Type"
          className={`
            pointer-events-auto w-9 h-9 rounded-lg flex items-center justify-center text-base
            border backdrop-blur-md transition-all cursor-pointer
            ${showPlateType
              ? 'bg-primary/25 border-primary/50 shadow-[0_0_12px_rgba(100,200,120,0.2)]'
              : 'bg-card/50 border-primary/15 hover:bg-card/70'
            }
          `}
        >
          🧫
        </button>

        {CATEGORIES.map(cat => {
          const owned = STORE_ITEMS.filter(
            i => i.category === cat.key && state.store.unlocked.has(i.id),
          )
          if (owned.length === 0) return null

          const isOpen = openCategory === cat.key
          const equipped = state.store.equipped[cat.key]

          return (
            <button
              key={cat.key}
              onClick={() => toggle(cat.key)}
              title={cat.label}
              className={`
                pointer-events-auto w-9 h-9 rounded-lg flex items-center justify-center text-base
                border backdrop-blur-md transition-all cursor-pointer
                ${isOpen
                  ? 'bg-primary/25 border-primary/50 shadow-[0_0_12px_rgba(100,200,120,0.2)]'
                  : equipped
                    ? 'bg-card/70 border-primary/30 hover:bg-primary/15'
                    : 'bg-card/50 border-primary/15 hover:bg-card/70'
                }
              `}
            >
              {cat.icon}
            </button>
          )
        })}
      </div>

      {/* Plate type flyout */}
      {showPlateType && (
        <div className="pointer-events-auto bg-card/85 backdrop-blur-xl border border-primary/25 rounded-xl shadow-[0_0_30px_rgba(100,200,120,0.1)] p-2 min-w-[180px] animate-in fade-in slide-in-from-left-2 duration-150">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider px-1 mb-1.5">
            Plate Type
          </div>
          <div className="flex flex-col gap-1">
            {NUTRIENT_PROFILES.map(p => {
              const isActive = state.nutrientProfile === p.id
              return (
                <button
                  key={p.id}
                  onClick={() => dispatch({ type: 'SET_NUTRIENT_PROFILE', profile: p.id })}
                  className={`
                    flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-all cursor-pointer
                    ${isActive
                      ? 'bg-primary/20 border border-primary/40'
                      : 'hover:bg-primary/10 border border-transparent'
                    }
                  `}
                >
                  <span className={`text-xs truncate ${isActive ? 'text-primary font-semibold' : 'text-foreground/80'}`}>
                    {p.label}
                  </span>
                  {isActive && (
                    <span className="ml-auto text-[9px] text-primary/60">✓</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Flyout */}
      {openCategory && (
        <div className="pointer-events-auto bg-card/85 backdrop-blur-xl border border-primary/25 rounded-xl shadow-[0_0_30px_rgba(100,200,120,0.1)] p-2 min-w-[140px] animate-in fade-in slide-in-from-left-2 duration-150">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider px-1 mb-1.5">
            {CATEGORIES.find(c => c.key === openCategory)?.label}
          </div>
          <div className="flex flex-col gap-1">
            {STORE_ITEMS
              .filter(i => i.category === openCategory && state.store.unlocked.has(i.id))
              .map(item => {
                const isEquipped = state.store.equipped[openCategory] === item.id

                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      if (isEquipped) {
                        dispatch({ type: 'UNEQUIP_ITEM', category: openCategory })
                      } else {
                        dispatch({ type: 'EQUIP_ITEM', itemId: item.id, category: openCategory })
                      }
                    }}
                    className={`
                      flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-all cursor-pointer
                      ${isEquipped
                        ? 'bg-primary/20 border border-primary/40'
                        : 'hover:bg-primary/10 border border-transparent'
                      }
                    `}
                  >
                    {item.preview ? (
                      <div
                        className="w-5 h-5 rounded-md border border-white/10 shrink-0"
                        style={{ backgroundColor: item.preview }}
                      />
                    ) : (
                      <span className="text-sm w-5 text-center shrink-0">{item.icon}</span>
                    )}
                    <span className={`text-xs truncate ${isEquipped ? 'text-primary font-semibold' : 'text-foreground/80'}`}>
                      {item.name}
                    </span>
                    {isEquipped && (
                      <span className="ml-auto text-[9px] text-primary/60">✓</span>
                    )}
                  </button>
                )
              })}
          </div>
        </div>
      )}
    </div>
  )
}
