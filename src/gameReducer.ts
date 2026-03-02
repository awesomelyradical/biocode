/**
 * @module gameReducer
 *
 * Pure reducer that drives the entire Biocode simulation.
 *
 * On every `TICK` the reducer:
 *  1. Applies wandering impulses, movement-pattern forces, and species-affinity forces.
 *  2. Runs cursor reactivity (repulsion halo + catch-and-hold when directly over a cell).
 *  3. Clamps speed, applies friction, and bounces off world boundaries.
 *  4. Manages energy economy: passive gain, size/speed cost, lifeFecundity modifier.
 *  5. Triggers automatic binary fission when energy exceeds the reproduction threshold.
 *  6. Resolves circle-circle collisions with elastic impulses and mass-ratio predation.
 *  7. Handles gene transfer via permeability when one cell eats another.
 *  8. Spawns nutrient particles from dead cells and ambient background nutrients.
 *  9. Lets living cells absorb nearby nutrients.
 *  10. Accrues biomass currency based on living population.
 *
 * Other action types handle trait adjustment, behavior changes, camera control,
 * manual reproduction, store purchases, and game restart.
 */

import type { GameState, GameAction, BacteriaState, TraitKey, BehaviorKey, Nutrient, StoreCategory } from './types'
import { species, createBacteria, spawnInitialPopulation, createDefaultBehavior, plasmidToProperties, TRAIT_KEYS, BASE_TRAIT_POINTS, WORLD_WIDTH, WORLD_HEIGHT, WORLD_RADIUS, STORE_ITEMS } from './data'

let nutrientId = 0

/**
 * Scatter nutrient particles at a death site.
 * Bigger bacteria spawn more particles (scaled by sizeFactor).
 */
function spawnNutrients(x: number, y: number, energy: number, color: string, sizeFactor: number = 1): Nutrient[] {
  const count = Math.floor((3 + Math.random() * 4) * Math.max(1, sizeFactor)) // more particles for bigger bacteria
  const perParticle = energy / count
  const nutrients: Nutrient[] = []
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2
    const speed = 0.3 + Math.random() * 0.8
    nutrients.push({
      id: `n${nutrientId++}`,
      x: x + (Math.random() - 0.5) * 10,
      y: y + (Math.random() - 0.5) * 10,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      energy: perParticle,
      radius: 2 + perParticle * 0.3,
      color,
      age: 0,
      maxAge: 300 + Math.floor(Math.random() * 200), // 10–17 seconds at 30tps
    })
  }
  return nutrients
}

/**
 * Main game state reducer. Every state transition flows through here.
 * @see GameAction for the full list of supported action types.
 */
export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'TICK': {
      const { mouseX, mouseY } = action
      const newBacteria: BacteriaState[] = []
      const toRemove: Set<string> = new Set()

      const updated = state.bacteria.map(b => {
        const sp = species.find(s => s.id === b.speciesId)!
        const effectiveSpeed = sp.baseSpeed * b.properties.speed
        const effectiveMass = sp.baseMass * b.properties.size
        const effectiveRadius = sp.baseSize * b.properties.size
        // Drag from surface area (radius²) and stickiness behavior
        const surfaceArea = effectiveRadius * effectiveRadius
        const baseDragFromArea = 1 - (surfaceArea / 2000) // larger = more drag
        const stickyMod = 1 - b.behavior.stickiness * 0.03 // stickiness adds drag
        const effectiveFriction = Math.max(0.90, Math.min(0.999, sp.baseFriction * baseDragFromArea * stickyMod))
        const effectiveSense = sp.baseSenseRadius * b.properties.senseRadius

        // Random wandering impulse
        const wanderAngle = b.angle + (Math.random() - 0.5) * 0.3
        const wanderForce = 0.02 * effectiveSpeed
        let nvx = b.vx + Math.cos(wanderAngle) * wanderForce
        let nvy = b.vy + Math.sin(wanderAngle) * wanderForce

        // ── Movement pattern effects ──
        // Patterns fade in and out — active ~60% of the time with smooth transitions
        if (b.movementPattern) {
          const t = b.age * 0.05
          const cycle = Math.sin(t * 0.4) // slow oscillation for on/off
          const patternStrength = Math.max(0, cycle * 1.5) // 0 when "resting", up to ~1 when active
          switch (b.movementPattern) {
            case 'pattern-spiral': {
              const spiralStr = 0.03 * effectiveSpeed * patternStrength
              nvx += Math.cos(t * 2) * spiralStr
              nvy += Math.sin(t * 2) * spiralStr
              break
            }
            case 'pattern-zigzag': {
              const zigDir = Math.sin(t * 4) > 0 ? 1 : -1
              const perpAngle = b.angle + Math.PI / 2
              const zigStr = 0.04 * effectiveSpeed * patternStrength
              nvx += Math.cos(perpAngle) * zigStr * zigDir
              nvy += Math.sin(perpAngle) * zigStr * zigDir
              break
            }
            case 'pattern-pulse': {
              // Periodic speed bursts
              const pulseFactor = 1.0 + Math.sin(t * 3) * 0.5
              nvx *= pulseFactor
              nvy *= pulseFactor
              break
            }
            case 'pattern-trail':
            case 'pattern-orbit':
              // These are visual-only patterns, handled in renderer
              break
          }
        }

        // ── Nutrient attraction ──
        for (const n of state.nutrients) {
          const ndx = n.x - b.x
          const ndy = n.y - b.y
          const ndist = Math.sqrt(ndx * ndx + ndy * ndy)
          if (ndist > effectiveSense || ndist < 1) continue
          const strength = 0.05 * effectiveSpeed * (1 - ndist / effectiveSense)
          nvx += (ndx / ndist) * strength
          nvy += (ndy / ndist) * strength
        }

        // ── Species affinity forces ──
        for (const other of state.bacteria) {
          if (other.id === b.id) continue
          const adx = other.x - b.x
          const ady = other.y - b.y
          const adist = Math.sqrt(adx * adx + ady * ady)
          if (adist > effectiveSense || adist < 1) continue

          const sameSpecies = other.speciesId === b.speciesId
          const affinity = sameSpecies ? b.behavior.kinAffinity : b.behavior.xenoAffinity
          if (affinity === 0) continue

          // Strength falls off with distance
          const strength = affinity * 0.04 * effectiveSpeed * (1 - adist / effectiveSense)
          nvx += (adx / adist) * strength
          nvy += (ady / adist) * strength
        }

        // ── Mouse reactivity (chase & catch) ──
        const dmx = mouseX - b.x
        const dmy = mouseY - b.y
        const mouseDist = Math.sqrt(dmx * dmx + dmy * dmy)
        const hoverRadius = effectiveRadius * 5
        const catchRadius = Math.max(effectiveRadius, 18)
        const isMouseInside = mouseDist < catchRadius

        if (isMouseInside) {
          // THE CATCH: mouse is directly over the bacterium — heavy friction to stop it
          nvx *= 0.4
          nvy *= 0.4
        } else if (mouseDist < hoverRadius && mouseDist > 0 && mouseX !== 0 && mouseY !== 0) {
          // THE CHASE: mouse is nearby — gentle repulsion pushes it away
          const repulsionStrength = (hoverRadius - mouseDist) / hoverRadius
          const angle = Math.atan2(dmy, dmx)
          const pushForce = repulsionStrength * 0.12 * effectiveSpeed
          nvx -= Math.cos(angle) * pushForce
          nvy -= Math.sin(angle) * pushForce
        }

        // Clamp speed
        const maxSpeed = effectiveSpeed * 3
        const currentSpeed = Math.sqrt(nvx * nvx + nvy * nvy)
        if (currentSpeed > maxSpeed) {
          nvx = (nvx / currentSpeed) * maxSpeed
          nvy = (nvy / currentSpeed) * maxSpeed
        }

        // Apply friction
        nvx *= effectiveFriction
        nvy *= effectiveFriction

        // Update position
        let nx = b.x + nvx
        let ny = b.y + nvy

        // World boundary bounce (circular)
        const padding = effectiveRadius + 5
        const cx = state.worldRadius
        const cy = state.worldRadius
        const dxFromCenter = nx - cx
        const dyFromCenter = ny - cy
        const distFromCenter = Math.sqrt(dxFromCenter * dxFromCenter + dyFromCenter * dyFromCenter)
        const maxDist = state.worldRadius - padding
        if (distFromCenter > maxDist) {
          // Push back inside the circle
          const normX = dxFromCenter / distFromCenter
          const normY = dyFromCenter / distFromCenter
          nx = cx + normX * maxDist
          ny = cy + normY * maxDist
          // Reflect velocity off the circular wall
          const dot = (nvx * normX + nvy * normY)
          const restitution = sp.baseRestitution * b.properties.restitution
          nvx = (nvx - 2 * dot * normX) * restitution
          nvy = (nvy - 2 * dot * normY) * restitution
        }

        // Energy: slowly gain, cost based on size and speed
        // lifeFecundity: positive = longer life (cheaper upkeep, slower repro), negative = shorter life (expensive upkeep, faster repro)
        const lfMod = b.behavior.lifeFecundity // -1..+1
        const energyCost = 0.01 * b.properties.size * b.properties.speed * (1 - lfMod * 0.3)
        const energyGain = 0.03 * (1 + lfMod * 0.2)
        const newEnergy = Math.min(100, Math.max(0, b.energy + energyGain - energyCost))

        // Reproduction check — fecundity lowers threshold, lifespan raises it
        const reproThreshold = sp.baseReproductionRate * b.properties.reproductionRate * (1 + lfMod * 0.5)
        // Must be large enough that halving still leaves >= 0.5 base size
        const canSplit = b.properties.size >= 1.0
        if (canSplit && newEnergy > reproThreshold && state.bacteria.length + newBacteria.length < 200) {
          const childAngle = Math.random() * Math.PI * 2
          const offset = effectiveRadius * 2.5
          const child = createBacteria(
            b.speciesId,
            b.x + Math.cos(childAngle) * offset,
            b.y + Math.sin(childAngle) * offset,
            state.species,
          )
          // Inherit parent plasmid with slight mutation
          const mutatedTraits = { ...b.plasmid.traits } as Record<TraitKey, number>
          for (const key of TRAIT_KEYS) {
            mutatedTraits[key] = Math.max(1, mutatedTraits[key] * (0.95 + Math.random() * 0.1))
          }
          // Normalize to keep sum = parent capacity
          const mutSum = TRAIT_KEYS.reduce((s, k) => s + mutatedTraits[k], 0)
          const scale = b.plasmid.capacity / mutSum
          for (const key of TRAIT_KEYS) mutatedTraits[key] *= scale

          // Halve size trait for child (splitting = half the mass), floor at half base
          const minSizeTrait = BASE_TRAIT_POINTS * 0.5
          mutatedTraits.size = Math.max(minSizeTrait, mutatedTraits.size / 2)
          const childCapacity = TRAIT_KEYS.reduce((s, k) => s + mutatedTraits[k], 0)
          child.plasmid = { capacity: childCapacity, traits: mutatedTraits }
          child.properties = plasmidToProperties(child.plasmid, sp.color)
          child.behavior = { ...b.behavior }
          child.radius = sp.baseSize * child.properties.size
          child.energy = 30
          newBacteria.push(child)

          // Halve parent's size trait too, floor at half base
          const parentTraits = { ...b.plasmid.traits }
          parentTraits.size = Math.max(minSizeTrait, parentTraits.size / 2)
          const parentCapacity = TRAIT_KEYS.reduce((s, k) => s + parentTraits[k], 0)
          const parentPlasmid = { capacity: parentCapacity, traits: parentTraits }
          const parentProps = plasmidToProperties(parentPlasmid, sp.color)

          // Parent loses energy
          return {
            ...b,
            x: nx, y: ny, vx: nvx, vy: nvy,
            plasmid: parentPlasmid,
            properties: parentProps,
            radius: sp.baseSize * parentProps.size,
            age: b.age + 1,
            energy: newEnergy - 40,
            angle: Math.atan2(nvy, nvx),
            flagellaPhase: b.flagellaPhase + 0.15,
          }
        }

        // Death check — starvation or burst (3x original size)
        if (newEnergy <= 0 || b.properties.size > 3.0) {
          toRemove.add(b.id)
        }

        return {
          ...b,
          x: nx, y: ny, vx: nvx, vy: nvy,
          radius: effectiveRadius,
          age: b.age + 1,
          energy: newEnergy,
          angle: Math.atan2(nvy, nvx),
          flagellaPhase: b.flagellaPhase + 0.15,
        }
      })

      // Collision detection & resolution (circle-circle) + eating
      for (let i = 0; i < updated.length; i++) {
        for (let j = i + 1; j < updated.length; j++) {
          const a = updated[i]
          const b = updated[j]
          if (toRemove.has(a.id) || toRemove.has(b.id)) continue

          const dx = b.x - a.x
          const dy = b.y - a.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          const minDist = a.radius + b.radius

          if (dist < minDist && dist > 0) {
            const spA = species.find(s => s.id === a.speciesId)!
            const spB = species.find(s => s.id === b.speciesId)!
            const mA = spA.baseMass * a.properties.size
            const mB = spB.baseMass * b.properties.size
            const massSum = mA + mB

            // Eating: aggression lowers the mass ratio needed to eat
            const eatThresholdA = 2.0 - a.behavior.aggression * 0.8 // 2.0 at 0 aggression, 1.2 at max
            const eatThresholdB = 2.0 - b.behavior.aggression * 0.8
            const massRatio = mA / mB
            if (massRatio > eatThresholdA && a.radius > b.radius * 1.3) {
              // A eats B
              toRemove.add(b.id)
              a.energy = Math.min(100, a.energy + 15)
              // Gene transfer: chance based on eater's permeability
              if (Math.random() < a.behavior.permeability && b.plasmid) {
                const dominantTrait = TRAIT_KEYS.reduce((best, k) =>
                  b.plasmid.traits[k] > b.plasmid.traits[best] ? k : best, TRAIT_KEYS[0])
                const gain = 2 + Math.random() * 3 // 2–5 bonus points
                a.plasmid = {
                  capacity: a.plasmid.capacity + gain,
                  traits: { ...a.plasmid.traits, [dominantTrait]: a.plasmid.traits[dominantTrait] + gain },
                }
                a.properties = plasmidToProperties(a.plasmid, spA.color)
                a.radius = spA.baseSize * a.properties.size
              }
              continue
            } else if (1 / massRatio > eatThresholdB && b.radius > a.radius * 1.3) {
              // B eats A
              toRemove.add(a.id)
              b.energy = Math.min(100, b.energy + 15)
              if (Math.random() < b.behavior.permeability && a.plasmid) {
                const dominantTrait = TRAIT_KEYS.reduce((best, k) =>
                  a.plasmid.traits[k] > a.plasmid.traits[best] ? k : best, TRAIT_KEYS[0])
                const gain = 2 + Math.random() * 3
                b.plasmid = {
                  capacity: b.plasmid.capacity + gain,
                  traits: { ...b.plasmid.traits, [dominantTrait]: b.plasmid.traits[dominantTrait] + gain },
                }
                b.properties = plasmidToProperties(b.plasmid, spB.color)
                b.radius = spB.baseSize * b.properties.size
              }
              continue
            }

            // Normal elastic collision
            // Separate
            const overlap = minDist - dist
            const nx = dx / dist
            const ny = dy / dist
            a.x -= nx * overlap * (mB / massSum)
            a.y -= ny * overlap * (mB / massSum)
            b.x += nx * overlap * (mA / massSum)
            b.y += ny * overlap * (mA / massSum)

            // Impulse
            const dvx = b.vx - a.vx
            const dvy = b.vy - a.vy
            const relVel = dvx * nx + dvy * ny

            if (relVel < 0) {
              const restitution = Math.min(
                spA.baseRestitution * a.properties.restitution,
                spB.baseRestitution * b.properties.restitution,
              )
              const impulse = -(1 + restitution) * relVel / (1 / mA + 1 / mB)
              a.vx -= (impulse / mA) * nx
              a.vy -= (impulse / mA) * ny
              b.vx += (impulse / mB) * nx
              b.vy += (impulse / mB) * ny
            }
          }
        }
      }

      const alive = updated.filter(b => !toRemove.has(b.id))

      // Spawn nutrients from dead bacteria — bigger ones release more
      const newNutrients: Nutrient[] = []
      for (const b of updated) {
        if (toRemove.has(b.id)) {
          const sp = species.find(s => s.id === b.speciesId)!
          const sizeBonus = b.radius / sp.baseSize // >1 for bigger-than-base bacteria
          const deathEnergy = Math.max(10, (b.energy + 20) * sizeBonus)
          newNutrients.push(...spawnNutrients(b.x, b.y, deathEnergy, sp.color, sizeBonus))
        }
      }

      // Ambient nutrient spawning (~1 particle every 3 ticks on average)
      if (Math.random() < 0.3) {
        const angle = Math.random() * Math.PI * 2
        const dist = Math.sqrt(Math.random()) * (state.worldRadius - 50)
        const ncx = state.worldRadius
        const ncy = state.worldRadius
        newNutrients.push({
          id: `n${nutrientId++}`,
          x: ncx + Math.cos(angle) * dist,
          y: ncy + Math.sin(angle) * dist,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          energy: 6 + Math.random() * 8,
          radius: 2.5 + Math.random() * 2,
          color: 'oklch(0.78 0.12 145)', // neutral green
          age: 0,
          maxAge: 600 + Math.floor(Math.random() * 400), // 20–33 seconds
        })
      }

      // Update existing nutrients (drift, friction, aging) and let bacteria absorb them
      const absorbedNutrients = new Set<string>()
      const existingNutrients = state.nutrients.map(n => {
        if (n.age >= n.maxAge) {
          absorbedNutrients.add(n.id)
          return n
        }
        // Check if any live bacterium is close enough to absorb
        for (const b of alive) {
          const dx = b.x - n.x
          const dy = b.y - n.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < b.radius + n.radius + 2) {
            b.energy = Math.min(100, b.energy + n.energy)
            absorbedNutrients.add(n.id)
            return n
          }
        }
        return {
          ...n,
          x: n.x + n.vx,
          y: n.y + n.vy,
          vx: n.vx * 0.98,
          vy: n.vy * 0.98,
          age: n.age + 1,
        }
      })

      const liveNutrients = [
        ...existingNutrients.filter(n => !absorbedNutrients.has(n.id)),
        ...newNutrients,
      ]

      // Biomass accrual — earn based on living population
      const biomassGain = alive.length * 0.02

      return {
        ...state,
        bacteria: [...alive, ...newBacteria],
        nutrients: liveNutrients,
        tick: state.tick + 1,
        biomass: state.biomass + biomassGain,
        selectedId: toRemove.has(state.selectedId ?? '') ? null : state.selectedId,
      }
    }

    case 'SPAWN':
      return { ...state, bacteria: [...state.bacteria, action.bacteria] }

    case 'REMOVE':
      return {
        ...state,
        bacteria: state.bacteria.filter(b => b.id !== action.id),
        selectedId: state.selectedId === action.id ? null : state.selectedId,
      }

    case 'SELECT': {
      // Apply equipped store cosmetics to newly selected bacterium
      if (action.id) {
        let updatedBacteria = state.bacteria
        const equippedColorId = state.store.equipped.colors
        const equippedPatternId = state.store.equipped.patterns
        if (equippedColorId || equippedPatternId) {
          const colorItem = equippedColorId ? STORE_ITEMS.find(i => i.id === equippedColorId) : null
          updatedBacteria = state.bacteria.map(b => {
            if (b.id !== action.id) return b
            const updates: Partial<BacteriaState> = {}
            if (colorItem?.preview) updates.membraneColor = colorItem.preview
            if (equippedPatternId) updates.movementPattern = equippedPatternId
            return { ...b, ...updates }
          })
        }
        return { ...state, selectedId: action.id, bacteria: updatedBacteria }
      }
      return { ...state, selectedId: action.id }
    }

    case 'ADJUST_TRAIT': {
      return {
        ...state,
        bacteria: state.bacteria.map(b => {
          if (b.id !== action.id) return b
          const sp = species.find(s => s.id === b.speciesId)!
          const { trait, delta } = action
          const oldVal = b.plasmid.traits[trait]
          const newVal = Math.max(1, oldVal + delta) // min 1 point per trait
          const actualDelta = newVal - oldVal
          if (actualDelta === 0) return b

          // Distribute the cost proportionally across other traits
          const otherKeys = TRAIT_KEYS.filter(k => k !== trait)
          const otherSum = otherKeys.reduce((s, k) => s + b.plasmid.traits[k], 0)
          if (otherSum <= otherKeys.length && actualDelta > 0) return b // others already at minimum

          const newTraits = { ...b.plasmid.traits, [trait]: newVal }
          // Take from others proportionally
          let remaining = -actualDelta // positive = need to distribute, negative = need to take
          for (const k of otherKeys) {
            const share = otherSum > 0 ? (b.plasmid.traits[k] / otherSum) * remaining : remaining / otherKeys.length
            newTraits[k] = Math.max(1, b.plasmid.traits[k] + share)
          }
          // Normalize so sum = capacity
          const sum = TRAIT_KEYS.reduce((s, k) => s + newTraits[k], 0)
          const scale = b.plasmid.capacity / sum
          for (const k of TRAIT_KEYS) newTraits[k] *= scale

          const newPlasmid = { ...b.plasmid, traits: newTraits }
          const newProps = plasmidToProperties(newPlasmid, sp.color)
          return {
            ...b,
            plasmid: newPlasmid,
            properties: newProps,
            radius: sp.baseSize * newProps.size,
          }
        }),
      }
    }

    case 'SET_BEHAVIOR': {
      return {
        ...state,
        bacteria: state.bacteria.map(b => {
          if (b.id !== action.id) return b
          return { ...b, behavior: { ...b.behavior, [action.key]: action.value } }
        }),
      }
    }

    case 'SET_CAMERA':
      return { ...state, camera: { ...state.camera, ...action.camera } }

    case 'REPRODUCE': {
      const parent = state.bacteria.find(b => b.id === action.parentId)
      if (!parent || parent.energy < 40) return state
      // Must be large enough to split (post-split >= 0.5 base)
      if (parent.properties.size < 1.0) return state
      const sp = species.find(s => s.id === parent.speciesId)!
      const childAngle = Math.random() * Math.PI * 2
      const offset = parent.radius * 2.5
      const child = createBacteria(
        parent.speciesId,
        parent.x + Math.cos(childAngle) * offset,
        parent.y + Math.sin(childAngle) * offset,
        state.species,
      )
      // Halve size trait for both parent and child
      const minSizeTrait = BASE_TRAIT_POINTS * 0.5
      const childTraits = { ...parent.plasmid.traits }
      childTraits.size = Math.max(minSizeTrait, childTraits.size / 2)
      const childCapacity = TRAIT_KEYS.reduce((s, k) => s + childTraits[k], 0)
      child.plasmid = { capacity: childCapacity, traits: childTraits }
      child.properties = plasmidToProperties(child.plasmid, sp.color)
      child.behavior = { ...parent.behavior }
      child.radius = sp.baseSize * child.properties.size
      child.energy = 30

      const parentTraits = { ...parent.plasmid.traits }
      parentTraits.size = Math.max(minSizeTrait, parentTraits.size / 2)
      const parentCapacity = TRAIT_KEYS.reduce((s, k) => s + parentTraits[k], 0)
      const parentPlasmid = { capacity: parentCapacity, traits: parentTraits }
      const parentProps = plasmidToProperties(parentPlasmid, sp.color)

      return {
        ...state,
        bacteria: [
          ...state.bacteria.map(b =>
            b.id === action.parentId ? {
              ...b,
              energy: b.energy - 40,
              plasmid: parentPlasmid,
              properties: parentProps,
              radius: sp.baseSize * parentProps.size,
            } : b
          ),
          child,
        ],
      }
    }

    case 'RESTART': {
      return {
        ...state,
        bacteria: spawnInitialPopulation(WORLD_RADIUS, 25),
        nutrients: [],
        selectedId: null,
        tick: 0,
        camera: { x: WORLD_RADIUS, y: WORLD_RADIUS, zoom: 0.4 },
        paused: false,
      }
    }

    case 'BUY_ITEM': {
      const item = STORE_ITEMS.find(i => i.id === action.itemId)
      if (!item || state.store.unlocked.has(action.itemId) || state.biomass < item.cost) return state
      const unlocked = new Set(state.store.unlocked)
      unlocked.add(action.itemId)
      return {
        ...state,
        biomass: state.biomass - item.cost,
        store: { ...state.store, unlocked },
      }
    }

    case 'EQUIP_ITEM': {
      if (!state.store.unlocked.has(action.itemId)) return state
      return {
        ...state,
        store: {
          ...state.store,
          equipped: { ...state.store.equipped, [action.category]: action.itemId },
        },
      }
    }

    case 'UNEQUIP_ITEM': {
      return {
        ...state,
        store: {
          ...state.store,
          equipped: { ...state.store.equipped, [action.category]: null },
        },
      }
    }

    default:
      return state
  }
}
