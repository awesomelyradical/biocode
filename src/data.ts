/**
 * @module data
 *
 * Static game data and factory functions.
 *
 * Contains the trait & behavior configuration tables, the five species
 * definitions, helper functions for creating bacteria and initial populations,
 * world-size constants, and the full catalogue of store items.
 */

import type { Species, BacteriaState, BacteriaProperties, TraitKey, Plasmid, BehaviorStats, BehaviorKey, StoreItem } from './types'

// ── Trait System ──

export const TRAIT_KEYS: TraitKey[] = ['speed', 'size', 'friction', 'restitution', 'senseRadius', 'reproductionRate']
export const BASE_TRAIT_POINTS = 10
export const INITIAL_PLASMID_CAPACITY = 60 // 10 per trait × 6 traits

export const TRAIT_CONFIGS: Record<TraitKey, { label: string; color: string; description: string }> = {
  speed:            { label: 'Speed',  color: '#40b8c4', description: 'Movement velocity' },
  size:             { label: 'Size',   color: '#cc8833', description: 'Physical mass & radius' },
  friction:         { label: 'Drag',   color: '#8855bb', description: 'Resistance to motion' },
  restitution:      { label: 'Bounce', color: '#bbaa33', description: 'Collision elasticity' },
  senseRadius:      { label: 'Sense',  color: '#cc4488', description: 'Detection range' },
  reproductionRate: { label: 'Repro',  color: '#55aa55', description: 'Reproduction threshold' },
}

export const BEHAVIOR_KEYS: BehaviorKey[] = ['kinAffinity', 'xenoAffinity', 'lifeFecundity', 'aggression', 'permeability']

export const BEHAVIOR_CONFIGS: Record<BehaviorKey, { label: string; color: string; description: string; min: number; max: number; step: number }> = {
  kinAffinity:    { label: 'Kin Affinity',   color: '#44bb77', description: 'Attract (+) or repel (-) own species',   min: -1, max: 1, step: 0.1 },
  xenoAffinity:   { label: 'Xeno Affinity',  color: '#bb5544', description: 'Attract (+) or repel (-) other species', min: -1, max: 1, step: 0.1 },
  lifeFecundity:  { label: 'Life / Fecund',  color: '#7799dd', description: 'Long-lived (+) vs fertile (-)',           min: -1, max: 1, step: 0.1 },
  aggression:     { label: 'Aggression',     color: '#dd4444', description: 'Predatory tendency when colliding',      min: 0,  max: 1, step: 0.1 },
  permeability:   { label: 'Permeability',   color: '#aa77cc', description: 'Gene uptake chance on eating',            min: 0,  max: 1, step: 0.1 },
}

/** Create a new behavior stats object with neutral defaults. */
export function createDefaultBehavior(): BehaviorStats {
  return {
    kinAffinity: 0.2,
    xenoAffinity: -0.2,
    lifeFecundity: 0,
    aggression: 0.3,
    permeability: 0.4,
  }
}

/** Create a plasmid with points distributed evenly across all traits. */
export function createPlasmid(capacity: number = INITIAL_PLASMID_CAPACITY): Plasmid {
  const perTrait = capacity / TRAIT_KEYS.length
  const traits = {} as Record<TraitKey, number>
  for (const key of TRAIT_KEYS) traits[key] = perTrait
  return { capacity, traits }
}

/**
 * Convert a plasmid's trait points into the runtime property multipliers
 * used by the physics simulation. Each multiplier is `points / BASE_TRAIT_POINTS`.
 */
export function plasmidToProperties(plasmid: Plasmid, color: string): BacteriaProperties {
  return {
    speed: plasmid.traits.speed / BASE_TRAIT_POINTS,
    size: plasmid.traits.size / BASE_TRAIT_POINTS,
    friction: plasmid.traits.friction / BASE_TRAIT_POINTS,
    restitution: plasmid.traits.restitution / BASE_TRAIT_POINTS,
    senseRadius: plasmid.traits.senseRadius / BASE_TRAIT_POINTS,
    reproductionRate: plasmid.traits.reproductionRate / BASE_TRAIT_POINTS,
    color,
  }
}

// ── Species Definitions ──

export const species: Species[] = [
  {
    id: 'coccus',
    name: 'Coccus',
    color: 'oklch(0.72 0.19 145)',       // green
    membrane: 'oklch(0.82 0.12 145)',
    baseSize: 12,
    baseSpeed: 2.0,
    baseFriction: 0.985,
    baseRestitution: 0.9,
    baseReproductionRate: 60,
    baseSenseRadius: 80,
    baseMass: 1,
    shape: 'circle',
    description: 'Small, fast cocci. They zip around and reproduce quickly.',
  },
  {
    id: 'bacillus',
    name: 'Bacillus',
    color: 'oklch(0.70 0.18 250)',       // blue
    membrane: 'oklch(0.80 0.10 250)',
    baseSize: 18,
    baseSpeed: 1.2,
    baseFriction: 0.990,
    baseRestitution: 0.85,
    baseReproductionRate: 80,
    baseSenseRadius: 100,
    baseMass: 2.5,
    shape: 'rod',
    description: 'Rod-shaped bacteria. Balanced speed and size.',
  },
  {
    id: 'spirillum',
    name: 'Spirillum',
    color: 'oklch(0.75 0.20 330)',       // magenta/pink
    membrane: 'oklch(0.85 0.12 330)',
    baseSize: 14,
    baseSpeed: 1.6,
    baseFriction: 0.988,
    baseRestitution: 0.88,
    baseReproductionRate: 70,
    baseSenseRadius: 150,
    baseMass: 1.8,
    shape: 'circle',
    description: 'Spiral-shaped with excellent sensing range.',
  },
  {
    id: 'macrophage',
    name: 'Macrophage',
    color: 'oklch(0.68 0.15 60)',        // amber/orange
    membrane: 'oklch(0.78 0.08 60)',
    baseSize: 35,
    baseSpeed: 0.5,
    baseFriction: 0.970,
    baseRestitution: 0.6,
    baseReproductionRate: 150,
    baseSenseRadius: 200,
    baseMass: 10,
    shape: 'circle',
    description: 'Large, slow-moving cells. Dominant in collisions.',
  },
  {
    id: 'vibrio',
    name: 'Vibrio',
    color: 'oklch(0.74 0.22 85)',        // yellow-gold
    membrane: 'oklch(0.84 0.14 85)',
    baseSize: 10,
    baseSpeed: 2.5,
    baseFriction: 0.992,
    baseRestitution: 0.95,
    baseReproductionRate: 45,
    baseSenseRadius: 60,
    baseMass: 0.8,
    shape: 'circle',
    description: 'Tiny and extremely fast. Reproduce rapidly but fragile.',
  },
]

// ── Helpers ──

let nextId = 1

/**
 * Create a single bacterium of the given species at (x, y).
 * Assigns a unique ID, random heading, a default even-distribution plasmid,
 * and starting energy in the range [50, 80].
 */
export function createBacteria(
  speciesId: string,
  x: number,
  y: number,
  speciesList: Species[] = species,
): BacteriaState {
  const sp = speciesList.find(s => s.id === speciesId)
  if (!sp) throw new Error(`Unknown species: ${speciesId}`)

  const angle = Math.random() * Math.PI * 2
  const speed = sp.baseSpeed * (0.8 + Math.random() * 0.4)

  const plasmid = createPlasmid()
  const properties = plasmidToProperties(plasmid, sp.color)

  return {
    id: `b${nextId++}`,
    speciesId,
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius: sp.baseSize * properties.size,
    properties,
    plasmid,
    behavior: createDefaultBehavior(),
    age: 0,
    energy: 50 + Math.random() * 30,
    angle,
    flagellaPhase: Math.random() * Math.PI * 2,
  }
}

/**
 * Populate the world with `count` random bacteria spread across all species.
 * Used at game start and on restart.
 */
export function spawnInitialPopulation(
  worldWidth: number,
  worldHeight: number,
  count: number = 20,
): BacteriaState[] {
  const bacteria: BacteriaState[] = []
  const margin = 100

  for (let i = 0; i < count; i++) {
    const sp = species[Math.floor(Math.random() * species.length)]
    const x = margin + Math.random() * (worldWidth - margin * 2)
    const y = margin + Math.random() * (worldHeight - margin * 2)
    bacteria.push(createBacteria(sp.id, x, y))
  }

  return bacteria
}

export const WORLD_WIDTH = 3000
export const WORLD_HEIGHT = 2000

// ── Store Items ──

export const STORE_ITEMS: StoreItem[] = [
  // Colors
  { id: 'color-neon-pink',    category: 'colors', name: 'Neon Pink',       description: 'Hot pink membrane glow',         cost: 50,  icon: '🩷', preview: 'oklch(0.70 0.25 350)' },
  { id: 'color-cyber-blue',   category: 'colors', name: 'Cyber Blue',      description: 'Electric blue bioluminescence', cost: 50,  icon: '💙', preview: 'oklch(0.65 0.22 240)' },
  { id: 'color-toxic-yellow', category: 'colors', name: 'Toxic Yellow',    description: 'Hazardous yellow tint',          cost: 50,  icon: '💛', preview: 'oklch(0.85 0.20 95)' },
  { id: 'color-void-purple',  category: 'colors', name: 'Void Purple',     description: 'Deep space purple aura',         cost: 75,  icon: '💜', preview: 'oklch(0.55 0.25 300)' },
  { id: 'color-blood-red',    category: 'colors', name: 'Blood Red',       description: 'Crimson predator hue',           cost: 75,  icon: '❤️', preview: 'oklch(0.55 0.25 25)' },
  { id: 'color-gold',         category: 'colors', name: 'Golden',          description: 'Prestigious gold shimmer',       cost: 150, icon: '✨', preview: 'oklch(0.80 0.18 80)' },

  // Movement patterns
  { id: 'pattern-spiral',     category: 'patterns', name: 'Spiral',        description: 'Bacteria move in spirals',       cost: 100, icon: '🌀' },
  { id: 'pattern-zigzag',     category: 'patterns', name: 'Zigzag',        description: 'Erratic zigzag movement',        cost: 100, icon: '⚡' },
  { id: 'pattern-pulse',      category: 'patterns', name: 'Pulse',         description: 'Rhythmic size pulsing',          cost: 80,  icon: '💓' },
  { id: 'pattern-trail',      category: 'patterns', name: 'Trail',         description: 'Leave fading particle trails',   cost: 120, icon: '✨' },
  { id: 'pattern-orbit',      category: 'patterns', name: 'Orbit',         description: 'Small orbiting particles',       cost: 150, icon: '🪐' },

  // Backgrounds
  { id: 'bg-dark-void',       category: 'backgrounds', name: 'Dark Void',     description: 'Pitch black void',            cost: 0,   icon: '🌑' },
  { id: 'bg-deep-ocean',      category: 'backgrounds', name: 'Deep Ocean',    description: 'Dark blue oceanic depths',    cost: 60,  icon: '🌊', preview: 'oklch(0.12 0.04 240)' },
  { id: 'bg-blood-agar',      category: 'backgrounds', name: 'Blood Agar',    description: 'Classic red agar plate',      cost: 80,  icon: '🔴', preview: 'oklch(0.15 0.06 20)' },
  { id: 'bg-aurora',          category: 'backgrounds', name: 'Aurora',         description: 'Northern lights gradient',    cost: 120, icon: '🌌', preview: 'oklch(0.14 0.05 180)' },
  { id: 'bg-toxic-green',     category: 'backgrounds', name: 'Toxic Green',   description: 'Radioactive green glow',      cost: 100, icon: '☢️', preview: 'oklch(0.10 0.06 145)' },

  // Music / Ambience
  { id: 'music-ambient-hum',  category: 'music', name: 'Ambient Hum',       description: 'Deep resonant background hum',  cost: 60,  icon: '🎵' },
  { id: 'music-heartbeat',    category: 'music', name: 'Heartbeat',         description: 'Rhythmic heartbeat pulse',      cost: 80,  icon: '💗' },
  { id: 'music-static',       category: 'music', name: 'Static',            description: 'Crackling radio static',        cost: 60,  icon: '📻' },
  { id: 'music-synth-wave',   category: 'music', name: 'Synth Wave',        description: 'Retro synthwave ambience',      cost: 100, icon: '🎹' },
  { id: 'music-nature',       category: 'music', name: 'Nature',            description: 'Rain and wind sounds',          cost: 80,  icon: '🌧️' },
]
