// ── Game Types ──

export interface Species {
  id: string
  name: string
  color: string           // oklch color string
  membrane: string        // lighter oklch for membrane ring
  baseSize: number        // radius in world units
  baseSpeed: number       // velocity multiplier
  baseFriction: number    // drag coefficient (0–1, higher = more drag)
  baseRestitution: number // bounciness (0–1)
  baseReproductionRate: number // energy cost to reproduce
  baseSenseRadius: number // how far it can "see" other bacteria
  baseMass: number        // collision mass
  shape: 'circle' | 'ellipse' | 'rod' // visual shape
  description: string
}

export type TraitKey = 'speed' | 'size' | 'friction' | 'restitution' | 'senseRadius' | 'reproductionRate'

export interface Plasmid {
  capacity: number                    // total distributable points
  traits: Record<TraitKey, number>    // points per trait, sum ≤ capacity
}

export interface BehaviorStats {
  kinAffinity: number       // -1 repel … +1 attract own species
  xenoAffinity: number      // -1 repel … +1 attract other species
  lifeFecundity: number     // -1 short-lived/fertile … +1 long-lived/barren
  aggression: number        //  0 passive … 1 predatory
  permeability: number      //  0 sealed … 1 porous (gene transfer chance)
}

export type BehaviorKey = keyof BehaviorStats

export interface BacteriaProperties {
  speed: number
  size: number
  friction: number
  restitution: number
  senseRadius: number
  reproductionRate: number
  color: string
}

export interface BacteriaState {
  id: string
  speciesId: string
  x: number
  y: number
  vx: number
  vy: number
  radius: number          // current radius (baseSize * properties.size)
  properties: BacteriaProperties
  plasmid: Plasmid
  behavior: BehaviorStats
  age: number             // ticks alive
  energy: number          // 0–100
  angle: number           // facing direction (radians)
  flagellaPhase: number   // animation phase for flagella
  membraneColor?: string  // custom membrane color from store
  movementPattern?: string // store pattern id (e.g. 'pattern-spiral')
}

export interface CameraState {
  x: number   // world-space center X
  y: number   // world-space center Y
  zoom: number // scale factor (1 = default, >1 = zoomed in)
}

export interface Nutrient {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  energy: number    // energy value when consumed
  radius: number
  color: string     // inherited from dead bacterium's species
  age: number       // ticks alive, for fade-out
  maxAge: number
}

export type StoreCategory = 'colors' | 'patterns' | 'backgrounds' | 'music'

export interface StoreItem {
  id: string
  category: StoreCategory
  name: string
  description: string
  cost: number
  icon: string          // emoji or short symbol
  preview?: string      // color/value for preview
}

export interface StoreState {
  unlocked: Set<string> // item IDs the player has purchased
  equipped: Record<StoreCategory, string | null> // currently active item per category
}

export type GameAction =
  | { type: 'TICK'; mouseX: number; mouseY: number }
  | { type: 'SPAWN'; bacteria: BacteriaState }
  | { type: 'REMOVE'; id: string }
  | { type: 'SELECT'; id: string | null }
  | { type: 'ADJUST_TRAIT'; id: string; trait: TraitKey; delta: number }
  | { type: 'SET_BEHAVIOR'; id: string; key: BehaviorKey; value: number }
  | { type: 'SET_CAMERA'; camera: Partial<CameraState> }
  | { type: 'REPRODUCE'; parentId: string }
  | { type: 'RESTART' }
  | { type: 'BUY_ITEM'; itemId: string }
  | { type: 'EQUIP_ITEM'; itemId: string; category: StoreCategory }
  | { type: 'UNEQUIP_ITEM'; category: StoreCategory }

export interface GameState {
  bacteria: BacteriaState[]
  nutrients: Nutrient[]
  species: Species[]
  camera: CameraState
  selectedId: string | null
  tick: number
  worldWidth: number
  worldHeight: number
  paused: boolean
  biomass: number
  store: StoreState
}
