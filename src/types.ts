/**
 * @module types
 *
 * Core type definitions for the Biocode bacteria simulation.
 *
 * Defines every domain object — species templates, individual bacteria state,
 * the plasmid / trait genetic system, camera, nutrients, the cosmetic store,
 * and the full set of game actions dispatched through the reducer.
 */

// ── Game Types ──

/** Template describing a bacterial species (immutable after init). */
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

/** The six adjustable genetic traits carried on a bacterium's plasmid. */
export type TraitKey = 'speed' | 'size' | 'friction' | 'restitution' | 'senseRadius' | 'reproductionRate'

/**
 * A plasmid is a fixed-capacity pool of trait points.
 * Points can be redistributed between traits but their sum always equals `capacity`.
 */
export interface Plasmid {
  capacity: number                    // total distributable points
  traits: Record<TraitKey, number>    // points per trait, sum ≤ capacity
}

/**
 * Behavioral sliders that control how a bacterium interacts with the world.
 * Each value is a continuous float in the range shown in its comment.
 */
export interface BehaviorStats {
  kinAffinity: number       // -1 repel … +1 attract own species
  xenoAffinity: number      // -1 repel … +1 attract other species
  lifeFecundity: number     // -1 short-lived/fertile … +1 long-lived/barren
  aggression: number        //  0 passive … 1 predatory
  permeability: number      //  0 sealed … 1 porous (gene transfer chance)
}

export type BehaviorKey = keyof BehaviorStats

/** Computed properties derived from a plasmid's trait point distribution. */
export interface BacteriaProperties {
  speed: number
  size: number
  friction: number
  restitution: number
  senseRadius: number
  reproductionRate: number
  color: string
}

/** Full mutable state of a single bacterium in the simulation. */
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

/** Viewport camera (world-space center + zoom level). */
export interface CameraState {
  x: number   // world-space center X
  y: number   // world-space center Y
  zoom: number // scale factor (1 = default, >1 = zoomed in)
}

/** A floating nutrient particle released when a bacterium dies. */
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

/** The four cosmetic store categories. */
export type StoreCategory = 'colors' | 'patterns' | 'backgrounds' | 'music'

/** A purchasable cosmetic item in the store. */
export interface StoreItem {
  id: string
  category: StoreCategory
  name: string
  description: string
  cost: number
  icon: string          // emoji or short symbol
  preview?: string      // color/value for preview
}

/** Player's store progress — what's been bought and what's currently active. */
export interface StoreState {
  unlocked: Set<string> // item IDs the player has purchased
  equipped: Record<StoreCategory, string | null> // currently active item per category
}

/**
 * Union of all actions that can be dispatched to the game reducer.
 *
 * - `TICK` — advance the simulation one step (physics, collisions, energy, reproduction)
 * - `SPAWN` / `REMOVE` — add or remove a single bacterium
 * - `SELECT` — set the player-selected bacterium (or null to deselect)
 * - `ADJUST_TRAIT` — redistribute plasmid trait points
 * - `SET_BEHAVIOR` — change a behavioral slider
 * - `SET_CAMERA` — pan / zoom the viewport
 * - `REPRODUCE` — manually trigger binary fission on a bacterium
 * - `RESTART` — reset the simulation
 * - `BUY_ITEM` / `EQUIP_ITEM` / `UNEQUIP_ITEM` — cosmetic store operations
 */
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

/** The complete, serialisable game state passed through the reducer. */
export interface GameState {
  bacteria: BacteriaState[]
  nutrients: Nutrient[]
  species: Species[]
  camera: CameraState
  selectedId: string | null
  tick: number
  worldWidth: number
  worldHeight: number
  worldRadius: number
  paused: boolean
  biomass: number
  store: StoreState
}
