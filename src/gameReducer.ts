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

import type { GameState, GameAction, BacteriaState, TraitKey, BehaviorKey, Nutrient, Bond, StoreCategory } from './types'
import { species, createBacteria, spawnInitialPopulation, createDefaultBehavior, plasmidToProperties, TRAIT_KEYS, BASE_TRAIT_POINTS, WORLD_WIDTH, WORLD_HEIGHT, WORLD_RADIUS, STORE_ITEMS, NUTRIENT_PROFILES } from './data'
import { SpatialGrid } from './lib/spatialGrid'

const GRID_CELL_SIZE = 150
const WORLD_GRID_SIZE = WORLD_RADIUS * 2

// Hooke's law spring constants for cyanobacteria bonds
const BOND_STIFFNESS = 0.5     // spring constant k
const BOND_DAMPING = 0.6       // velocity damping along bond axis
const BOND_BREAK_STRETCH = 3.0 // break when stretched to 3× rest length
const BOND_MAX_FORCE = 1.5     // clamp spring force to prevent violent oscillation
const MAX_ABSORB_PER_TICK = 4  // max energy a cell can absorb per tick

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
      const newBonds: Bond[] = []
      const toRemove: Set<string> = new Set()

      // Build spatial grids for O(1) proximity lookups
      const nutrientGrid = new SpatialGrid<Nutrient>(GRID_CELL_SIZE, WORLD_GRID_SIZE)
      for (const n of state.nutrients) nutrientGrid.insert(n.x, n.y, n)

      const bacteriaGridPrev = new SpatialGrid<BacteriaState>(GRID_CELL_SIZE, WORLD_GRID_SIZE)
      for (const b of state.bacteria) bacteriaGridPrev.insert(b.x, b.y, b)

      // Track which ends are occupied from previous frame's bonds
      // Key: "cellId:head" or "cellId:tail"
      const prevOccupiedEnds = new Set<string>()
      for (const bond of state.bonds) {
        prevOccupiedEnds.add(`${bond.idA}:${bond.endA}`)
        prevOccupiedEnds.add(`${bond.idB}:${bond.endB}`)
      }
      const prevMatureCyano = new Set<string>()
      for (const b of state.bacteria) {
        if (b.speciesId === 'cyanobacteria'
          && prevOccupiedEnds.has(`${b.id}:head`)
          && prevOccupiedEnds.has(`${b.id}:tail`)) {
          prevMatureCyano.add(b.id)
        }
      }

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

        // Brownian motion + wandering impulse (smaller cells jitter more)
        const brownianScale = 0.04 / Math.sqrt(effectiveMass)
        const bx = (Math.random() - 0.5) * brownianScale
        const by = (Math.random() - 0.5) * brownianScale
        const wanderAngle = b.angle + (Math.random() - 0.5) * 0.3
        const wanderForce = 0.02 * effectiveSpeed
        let nvx = b.vx + Math.cos(wanderAngle) * wanderForce + bx
        let nvy = b.vy + Math.sin(wanderAngle) * wanderForce + by

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

        // ── Nutrient attraction (spatial grid query) ──
        // Mature cyanobacteria (interior cells with 2+ bonds) don't seek nutrients
        if (!prevMatureCyano.has(b.id)) {
        const nearbyNutrients = nutrientGrid.query(b.x, b.y, effectiveSense)
        for (let ni = 0; ni < nearbyNutrients.length; ni++) {
          const n = nearbyNutrients[ni]!
          const ndx = n.x - b.x
          const ndy = n.y - b.y
          const ndist2 = ndx * ndx + ndy * ndy
          if (ndist2 > effectiveSense * effectiveSense || ndist2 < 1) continue
          const ndist = Math.sqrt(ndist2)
          const strength = 0.05 * effectiveSpeed * (1 - ndist / effectiveSense)
          nvx += (ndx / ndist) * strength
          nvy += (ndy / ndist) * strength
        }
        }

        // ── Species affinity forces (spatial grid query on previous frame) ──
        const nearbyBacteria = bacteriaGridPrev.query(b.x, b.y, effectiveSense)
        for (let bi = 0; bi < nearbyBacteria.length; bi++) {
          const other = nearbyBacteria[bi]!
          if (other.id === b.id) continue
          const adx = other.x - b.x
          const ady = other.y - b.y
          const adist2 = adx * adx + ady * ady
          if (adist2 > effectiveSense * effectiveSense || adist2 < 1) continue
          const adist = Math.sqrt(adist2)

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
        // Size pressure: larger bacteria have much lower reproduction thresholds
        const sizeMultiplier = b.properties.size
        const sizePressure = sizeMultiplier > 1.2 ? Math.max(0.1, 1 - (sizeMultiplier - 1.2) * 0.6) : 1
        const reproThreshold = sp.baseReproductionRate * b.properties.reproductionRate * (1 + lfMod * 0.5) * sizePressure * (b.antibioticBoost ? 0.5 : 1)
        // Must be large enough that halving still leaves >= 0.5 base size
        const canSplit = b.properties.size >= 1.0
        if (canSplit && newEnergy > reproThreshold && state.bacteria.length + newBacteria.length < 1000) {
          // Cyanobacteria divide along their facing axis from a free end; others use random angle
          let childAngle = Math.random() * Math.PI * 2
          let parentEnd: 'head' | 'tail' = 'head'
          let childEnd: 'head' | 'tail' = 'tail'
          if (b.speciesId === 'cyanobacteria') {
            // Pick a free end — head first, then tail, skip if both occupied
            const headFree = !prevOccupiedEnds.has(`${b.id}:head`)
              && !newBonds.some(bd => (bd.idA === b.id && bd.endA === 'head') || (bd.idB === b.id && bd.endB === 'head'))
            const tailFree = !prevOccupiedEnds.has(`${b.id}:tail`)
              && !newBonds.some(bd => (bd.idA === b.id && bd.endA === 'tail') || (bd.idB === b.id && bd.endB === 'tail'))
            if (!headFree && !tailFree) {
              // Both ends occupied — cannot divide, fall through to normal return
            } else {
              if (headFree) {
                childAngle = b.angle           // divide forward from head
                parentEnd = 'head'
                childEnd = 'tail'              // child's tail faces parent's head
              } else {
                childAngle = b.angle + Math.PI // divide backward from tail
                parentEnd = 'tail'
                childEnd = 'head'              // child's head faces parent's tail
              }
            }
            if (!headFree && !tailFree) {
              // Skip division entirely for fully bonded cyanobacteria
              return {
                ...b,
                x: nx, y: ny, vx: nvx, vy: nvy,
                radius: sp.baseSize * b.properties.size,
                age: b.age + 1,
                energy: newEnergy,
                angle: b.initialAngle != null
                  ? b.initialAngle + Math.max(-0.035, Math.min(0.035,
                      ((b.angle - b.initialAngle + Math.PI * 3) % (Math.PI * 2) - Math.PI)
                      + ((Math.atan2(nvy, nvx) - b.angle + Math.PI * 3) % (Math.PI * 2) - Math.PI) * 0.02
                    ))
                  : Math.atan2(nvy, nvx),
                flagellaPhase: b.flagellaPhase + 0.15,
              }
            }
          }
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
          const childPlasmid = { capacity: childCapacity, traits: mutatedTraits }
          const childProps = plasmidToProperties(childPlasmid, sp.color)
          const childRadius = sp.baseSize * childProps.size

          // Compute post-division parent radius for accurate placement
          const parentPostTraits = { ...b.plasmid.traits }
          parentPostTraits.size = Math.max(minSizeTrait, parentPostTraits.size / 2)
          const parentPostProps = plasmidToProperties({ capacity: TRAIT_KEYS.reduce((s, k) => s + parentPostTraits[k], 0), traits: parentPostTraits }, sp.color)
          const parentPostRadius = sp.baseSize * parentPostProps.size

          // Spawn child so ends just touch (center-to-center = sum of radii + small gap)
          const bondGap = 2
          const offset = parentPostRadius + childRadius + bondGap
          const child = createBacteria(
            b.speciesId,
            b.x + Math.cos(childAngle) * offset,
            b.y + Math.sin(childAngle) * offset,
            state.species,
          )
          // Cyanobacteria children inherit the parent's locked axis
          if (b.initialAngle != null) {
            child.angle = b.angle
            child.initialAngle = b.initialAngle
          }
          child.plasmid = childPlasmid
          child.properties = childProps
          child.behavior = { ...b.behavior }
          child.radius = childRadius
          child.energy = 30
          child.splitPhase = 1
          newBacteria.push(child)

          // Create elastic bond between parent and child for cyanobacteria (end-to-end)
          if (b.speciesId === 'cyanobacteria') {
            newBonds.push({
              idA: b.id,
              idB: child.id,
              endA: parentEnd,
              endB: childEnd,
              restLength: bondGap,
            })
          }

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
            angle: b.initialAngle != null
              ? b.initialAngle + Math.max(-0.035, Math.min(0.035,
                  ((b.angle - b.initialAngle + Math.PI * 3) % (Math.PI * 2) - Math.PI)
                  + ((Math.atan2(nvy, nvx) - b.angle + Math.PI * 3) % (Math.PI * 2) - Math.PI) * 0.02
                ))
              : Math.atan2(nvy, nvx),
            flagellaPhase: b.flagellaPhase + 0.15,
            splitPhase: 1,
          }
        }

        // Death check — starvation, or increasing chance above 2.5× size (certain at 3×)
        if (newEnergy <= 0) {
          toRemove.add(b.id)
        } else if (b.properties.size > 2.5) {
          // Probability ramps from 0% at 2.5× to ~100% at 3×
          const burstChance = Math.min(1, (b.properties.size - 2.5) * 2)
          if (Math.random() < burstChance * 0.1) { // per-tick chance, so ~10% per tick at 3×
            toRemove.add(b.id)
          }
        }

        return {
          ...b,
          x: nx, y: ny, vx: nvx, vy: nvy,
          radius: sp.baseSize * b.properties.size,
          age: b.age + 1,
          energy: newEnergy,
          angle: b.initialAngle != null
            ? b.initialAngle + Math.max(-0.035, Math.min(0.035,
                ((b.angle - b.initialAngle + Math.PI * 3) % (Math.PI * 2) - Math.PI)
                + ((Math.atan2(nvy, nvx) - b.angle + Math.PI * 3) % (Math.PI * 2) - Math.PI) * 0.02
              ))
            : Math.atan2(nvy, nvx),
          flagellaPhase: b.flagellaPhase + 0.15,
          splitPhase: b.splitPhase ? Math.max(0, b.splitPhase - 0.06) : undefined,
          antibioticBoost: b.antibioticBoost ? b.antibioticBoost - 1 : undefined,
        }
      })

      // ── Elastic bond forces (Hooke's law) ──
      // Build index for O(1) lookups by id
      const byId = new Map<string, BacteriaState>()
      for (const b of updated) byId.set(b.id, b)

      const brokenBonds = new Set<number>()
      for (let bi = 0; bi < state.bonds.length; bi++) {
        const bond = state.bonds[bi]!
        const a = byId.get(bond.idA)
        const b = byId.get(bond.idB)
        if (!a || !b || toRemove.has(a.id) || toRemove.has(b.id)) {
          brokenBonds.add(bi)
          continue
        }

        // Compute end-point positions (head = forward along angle, tail = backward)
        const endASign = bond.endA === 'head' ? 1 : -1
        const endBSign = bond.endB === 'head' ? 1 : -1
        const axA = a.x + Math.cos(a.angle) * a.radius * endASign
        const ayA = a.y + Math.sin(a.angle) * a.radius * endASign
        const bxB = b.x + Math.cos(b.angle) * b.radius * endBSign
        const byB = b.y + Math.sin(b.angle) * b.radius * endBSign

        const dx = bxB - axA
        const dy = byB - ayA
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < 0.001) continue

        // Break if stretched too far (use center-to-center for break check)
        const cdx = b.x - a.x
        const cdy = b.y - a.y
        const centerDist = Math.sqrt(cdx * cdx + cdy * cdy)
        if (centerDist > (a.radius + b.radius + bond.restLength) * BOND_BREAK_STRETCH) {
          brokenBonds.add(bi)
          continue
        }

        // Hooke's law on end-to-end distance: F = -k * (dist - restLength)
        const displacement = dist - bond.restLength
        const rawForce = BOND_STIFFNESS * displacement
        const forceMag = Math.max(-BOND_MAX_FORCE, Math.min(BOND_MAX_FORCE, rawForce))
        const nx = dx / dist
        const ny = dy / dist

        // Apply equal and opposite forces to cell centers
        a.vx += nx * forceMag
        a.vy += ny * forceMag
        b.vx -= nx * forceMag
        b.vy -= ny * forceMag

        // Damping: reduce relative velocity along bond axis
        const dvx = b.vx - a.vx
        const dvy = b.vy - a.vy
        const relVelAlongBond = dvx * nx + dvy * ny
        const dampForce = relVelAlongBond * BOND_DAMPING
        a.vx += nx * dampForce
        a.vy += ny * dampForce
        b.vx -= nx * dampForce
        b.vy -= ny * dampForce

        // Torque: align cell axes so bonded ends point toward each other
        if (a.initialAngle != null) {
          // The bond axis from a's end toward b's end
          const bondAngle = Math.atan2(dy, dx)
          // a's bonded end should point toward b — expected angle depends on which end
          const targetA = bond.endA === 'head' ? bondAngle : bondAngle + Math.PI
          const diffA = ((targetA - a.initialAngle + Math.PI * 3) % (Math.PI * 2) - Math.PI)
          if (Math.abs(diffA) > 0.035) {
            a.initialAngle = a.initialAngle + diffA * 0.01
          }
          if (b.initialAngle != null) {
            const targetB = bond.endB === 'head' ? bondAngle + Math.PI : bondAngle
            const diffB = ((targetB - b.initialAngle + Math.PI * 3) % (Math.PI * 2) - Math.PI)
            if (Math.abs(diffB) > 0.035) {
              b.initialAngle = b.initialAngle + diffB * 0.01
            }
          }
        }
      }

      // Collect surviving bonds + new bonds from this tick
      const survivingBonds: Bond[] = []
      for (let bi = 0; bi < state.bonds.length; bi++) {
        if (!brokenBonds.has(bi)) survivingBonds.push(state.bonds[bi]!)
      }

      // Track occupied ends from current frame's bonds — mature = both ends bonded
      const occupiedEnds = new Set<string>()
      for (const bond of survivingBonds) {
        occupiedEnds.add(`${bond.idA}:${bond.endA}`)
        occupiedEnds.add(`${bond.idB}:${bond.endB}`)
      }
      for (const bond of newBonds) {
        occupiedEnds.add(`${bond.idA}:${bond.endA}`)
        occupiedEnds.add(`${bond.idB}:${bond.endB}`)
      }
      const matureCyano = new Set<string>()
      for (const b of updated) {
        if (b.speciesId === 'cyanobacteria'
          && occupiedEnds.has(`${b.id}:head`)
          && occupiedEnds.has(`${b.id}:tail`)) {
          matureCyano.add(b.id)
        }
      }

      // Cyanobacteria photosynthesis — occasionally emit a nutrient nearby
      // Mature cyanobacteria (2+ bonds) emit more frequently since they don't consume
      const photoNutrients: Nutrient[] = []
      for (const b of updated) {
        if (b.speciesId !== 'cyanobacteria' || toRemove.has(b.id)) continue
        const isMature = matureCyano.has(b.id)
        const emitChance = isMature ? 0.06 : 0.03
        if (Math.random() < emitChance) {
          const angle = Math.random() * Math.PI * 2
          photoNutrients.push({
            id: `n${nutrientId++}`,
            x: b.x + Math.cos(angle) * (b.radius + 3),
            y: b.y + Math.sin(angle) * (b.radius + 3),
            vx: Math.cos(angle) * 0.05,
            vy: Math.sin(angle) * 0.05,
            energy: 1 + Math.random(),
            radius: 1.5 + Math.random() * 0.5,
            color: 'oklch(0.78 0.14 170)', // cyan-green tint
            age: 0,
            maxAge: 400 + Math.floor(Math.random() * 200),
          })
        }
      }

      // Collision detection & resolution — spatial grid accelerated
      // Build set of bonded pairs to exempt from collision
      const bondedPairs = new Set<string>()
      for (const bond of [...survivingBonds, ...newBonds]) {
        bondedPairs.add(`${bond.idA}:${bond.idB}`)
        bondedPairs.add(`${bond.idB}:${bond.idA}`)
      }

      const bacteriaGrid = new SpatialGrid<number>(GRID_CELL_SIZE, WORLD_GRID_SIZE)
      for (let i = 0; i < updated.length; i++) {
        const b = updated[i]!
        bacteriaGrid.insert(b.x, b.y, i)
      }

      const nearbyBuf: number[] = []
      for (let i = 0; i < updated.length; i++) {
        const a = updated[i]!
        if (toRemove.has(a.id)) continue
        const queryRadius = a.radius + GRID_CELL_SIZE // generous enough to catch all neighbors
        nearbyBuf.length = 0
        bacteriaGrid.query(a.x, a.y, queryRadius, nearbyBuf)
        for (let ni = 0; ni < nearbyBuf.length; ni++) {
          const j = nearbyBuf[ni]!
          if (j <= i) continue // avoid double-processing pairs
          const b = updated[j]!
          if (toRemove.has(b.id)) continue

          // Skip collision between bonded cells — bond physics handles their spacing
          if (bondedPairs.has(`${a.id}:${b.id}`)) continue

          const dx = b.x - a.x
          const dy = b.y - a.y
          const dist2 = dx * dx + dy * dy
          const minDist = a.radius + b.radius

          if (dist2 < minDist * minDist && dist2 > 0) {
            const dist = Math.sqrt(dist2)
            const spA = species.find(s => s.id === a.speciesId)!
            const spB = species.find(s => s.id === b.speciesId)!
            const mA = spA.baseMass * a.properties.size
            const mB = spB.baseMass * b.properties.size
            const massSum = mA + mB

            // Eating: aggression lowers the mass ratio needed to eat
            // Cyanobacteria are highly resistant — require 3× the normal mass ratio to eat them
            // Cyanobacteria are harmless — they never eat other species
            const cyanoResistA = b.speciesId === 'cyanobacteria' ? 3 : 1
            const cyanoResistB = a.speciesId === 'cyanobacteria' ? 3 : 1
            const eatThresholdA = (2.0 - a.behavior.aggression * 0.8) * cyanoResistA
            const eatThresholdB = (2.0 - b.behavior.aggression * 0.8) * cyanoResistB
            const massRatio = mA / mB
            if (a.speciesId !== 'cyanobacteria' && massRatio > eatThresholdA && a.radius > b.radius * 1.3) {
              toRemove.add(b.id)
              a.energy = Math.min(100, a.energy + 15)
              if (Math.random() < a.behavior.permeability && b.plasmid) {
                const dominantTrait = TRAIT_KEYS.reduce((best, k) =>
                  b.plasmid.traits[k] > b.plasmid.traits[best] ? k : best, TRAIT_KEYS[0])
                const gain = 2 + Math.random() * 3
                a.plasmid = {
                  capacity: a.plasmid.capacity + gain,
                  traits: { ...a.plasmid.traits, [dominantTrait]: a.plasmid.traits[dominantTrait] + gain },
                }
                a.properties = plasmidToProperties(a.plasmid, spA.color)
                a.radius = spA.baseSize * a.properties.size
              }
              continue
            } else if (b.speciesId !== 'cyanobacteria' && 1 / massRatio > eatThresholdB && b.radius > a.radius * 1.3) {
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
            const overlap = minDist - dist
            const nx = dx / dist
            const ny = dy / dist
            a.x -= nx * overlap * (mB / massSum)
            a.y -= ny * overlap * (mB / massSum)
            b.x += nx * overlap * (mA / massSum)
            b.y += ny * overlap * (mA / massSum)

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

          // Lateral repulsion between cyanobacteria long sides
          if (a.speciesId === 'cyanobacteria' && b.speciesId === 'cyanobacteria' && dist2 > 0) {
            const lateralRange = (a.radius + b.radius) * 3
            if (dist2 < lateralRange * lateralRange) {
              const d = dist2 < minDist * minDist ? Math.sqrt(dist2) : (() => { const v = Math.sqrt(dist2); return v })()
              const sepX = dx / d
              const sepY = dy / d
              // Axis of cell a (unit vector along its length)
              const axAx = Math.cos(a.angle)
              const axAy = Math.sin(a.angle)
              // Project separation onto a's axis — high dot = end-to-end, low = side-by-side
              const dotAxis = Math.abs(sepX * axAx + sepY * axAy)
              // Lateral component: 1 when perfectly side-by-side, 0 when end-to-end
              const lateralFactor = 1 - dotAxis
              if (lateralFactor > 0.3) {
                const strength = 0.04 * lateralFactor * (1 - d / lateralRange)
                a.vx -= sepX * strength
                a.vy -= sepY * strength
                b.vx += sepX * strength
                b.vy += sepY * strength
              }
            }
          }
        }
      }

      const alive = updated.filter(b => !toRemove.has(b.id))

      // Spawn nutrients from dead bacteria — bigger ones release more
      const newNutrients: Nutrient[] = []
      const alreadySpawnedNutrients = new Set<string>()
      for (const b of updated) {
        if (toRemove.has(b.id)) {
          alreadySpawnedNutrients.add(b.id)
          const sp = species.find(s => s.id === b.speciesId)!
          const sizeBonus = b.radius / sp.baseSize // >1 for bigger-than-base bacteria
          const deathEnergy = Math.max(10, (b.energy + 20) * sizeBonus)
          newNutrients.push(...spawnNutrients(b.x, b.y, deathEnergy, sp.color, sizeBonus))
        }
      }

      // Ambient nutrient spawning — rate from profile
      const profile = NUTRIENT_PROFILES.find(p => p.id === state.nutrientProfile) ?? NUTRIENT_PROFILES[0]
      if (Math.random() < profile.nutrientRate) {
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

      // Ambient antibiotic spawning — rate from profile
      const newAntibiotics: Nutrient[] = []
      if (Math.random() < profile.antibioticRate) {
        const angle = Math.random() * Math.PI * 2
        const dist = Math.sqrt(Math.random()) * (state.worldRadius - 50)
        const ncx = state.worldRadius
        const ncy = state.worldRadius
        newAntibiotics.push({
          id: `a${nutrientId++}`,
          x: ncx + Math.cos(angle) * dist,
          y: ncy + Math.sin(angle) * dist,
          vx: (Math.random() - 0.5) * 0.2,
          vy: (Math.random() - 0.5) * 0.2,
          energy: 0, // not used for energy
          radius: 3 + Math.random() * 1.5,
          color: 'oklch(0.65 0.25 25)', // red/toxic
          age: 0,
          maxAge: 800 + Math.floor(Math.random() * 400),
        })
      }

      // Update existing nutrients (drift, friction, aging) and let bacteria absorb them
      // Build a spatial grid of living bacteria for absorption lookups
      const aliveGrid = new SpatialGrid<BacteriaState>(GRID_CELL_SIZE, WORLD_GRID_SIZE)
      for (const b of alive) aliveGrid.insert(b.x, b.y, b)

      const absorbedNutrients = new Set<string>()
      const absorbedThisTick = new Map<string, number>() // energy absorbed per cell this tick
      const absorptionBuf: BacteriaState[] = []
      const existingNutrients = state.nutrients.map(n => {
        if (n.age >= n.maxAge) {
          absorbedNutrients.add(n.id)
          return n
        }
        // Check nearby bacteria via spatial grid
        absorptionBuf.length = 0
        aliveGrid.query(n.x, n.y, GRID_CELL_SIZE, absorptionBuf)
        for (let bi = 0; bi < absorptionBuf.length; bi++) {
          const b = absorptionBuf[bi]!
          // Mature cyanobacteria (2+ bonds) don't absorb nutrients
          if (matureCyano.has(b.id)) continue
          // Skip if this cell already hit its absorption cap this tick
          const alreadyAbsorbed = absorbedThisTick.get(b.id) ?? 0
          if (alreadyAbsorbed >= MAX_ABSORB_PER_TICK) continue
          const dx = b.x - n.x
          const dy = b.y - n.y
          const dist2 = dx * dx + dy * dy
          const thresh = b.radius + n.radius + 2
          if (dist2 < thresh * thresh) {
            const room = MAX_ABSORB_PER_TICK - alreadyAbsorbed
            const absorbed = Math.min(n.energy, room)
            b.energy = Math.min(100, b.energy + absorbed)
            absorbedThisTick.set(b.id, alreadyAbsorbed + absorbed)
            // Grow size trait from feeding — increase capacity so other traits stay unchanged
            const maxSizeTrait = BASE_TRAIT_POINTS * 3
            const sizeGrowth = absorbed * 0.06
            const oldSize = b.plasmid.traits.size
            const newSizeTrait = Math.min(maxSizeTrait, oldSize + sizeGrowth)
            const actualGrowth = newSizeTrait - oldSize
            const newCapacity = b.plasmid.capacity + actualGrowth
            b.plasmid = {
              capacity: newCapacity,
              traits: { ...b.plasmid.traits, size: newSizeTrait },
            }
            const sp = species.find(s => s.id === b.speciesId)!
            b.properties = plasmidToProperties(b.plasmid, sp.color)
            b.radius = sp.baseSize * b.properties.size
            absorbedNutrients.add(n.id)
            return n
          }
        }
        return {
          ...n,
          x: n.x + n.vx + (Math.random() - 0.5) * 0.3,
          y: n.y + n.vy + (Math.random() - 0.5) * 0.3,
          vx: n.vx * 0.98,
          vy: n.vy * 0.98,
          age: n.age + 1,
        }
      })

      const liveNutrients = [
        ...existingNutrients.filter(n => !absorbedNutrients.has(n.id)),
        ...newNutrients,
        ...photoNutrients,
      ]

      // Update existing antibiotics (drift, aging) and let bacteria absorb them
      const absorbedAntibiotics = new Set<string>()
      const abBuf: BacteriaState[] = []
      const existingAntibiotics = state.antibiotics.map(ab => {
        if (ab.age >= ab.maxAge) {
          absorbedAntibiotics.add(ab.id)
          return ab
        }
        abBuf.length = 0
        aliveGrid.query(ab.x, ab.y, GRID_CELL_SIZE, abBuf)
        for (let bi = 0; bi < abBuf.length; bi++) {
          const b = abBuf[bi]!
          if (toRemove.has(b.id)) continue
          const dx = b.x - ab.x
          const dy = b.y - ab.y
          const dist2 = dx * dx + dy * dy
          const thresh = b.radius + ab.radius + 2
          if (dist2 < thresh * thresh) {
            absorbedAntibiotics.add(ab.id)
            // Shrink the bacterium
            const sp = species.find(s => s.id === b.speciesId)!
            const shrink = b.plasmid.traits.size * 0.3
            const newSizeTrait = Math.max(BASE_TRAIT_POINTS * 0.3, b.plasmid.traits.size - shrink)
            const actualShrink = b.plasmid.traits.size - newSizeTrait
            b.plasmid = {
              capacity: b.plasmid.capacity - actualShrink,
              traits: { ...b.plasmid.traits, size: newSizeTrait },
            }
            b.properties = plasmidToProperties(b.plasmid, sp.color)
            b.radius = sp.baseSize * b.properties.size
            b.energy = Math.max(0, b.energy - 20)
            // 70% chance of death
            if (Math.random() < 0.7) {
              toRemove.add(b.id)
            } else {
              // Survivor gets a reproduction boost (150 ticks ≈ 5 seconds)
              b.antibioticBoost = 150
            }
            return ab
          }
        }
        return {
          ...ab,
          x: ab.x + ab.vx + (Math.random() - 0.5) * 0.2,
          y: ab.y + ab.vy + (Math.random() - 0.5) * 0.2,
          vx: ab.vx * 0.99,
          vy: ab.vy * 0.99,
          age: ab.age + 1,
        }
      })

      // Re-filter alive after antibiotic deaths
      const finalAlive = alive.filter(b => !toRemove.has(b.id))
      // Spawn nutrients from antibiotic deaths (skip bacteria already handled above)
      for (const b of alive) {
        if (toRemove.has(b.id) && !alreadySpawnedNutrients.has(b.id)) {
          const sp = species.find(s => s.id === b.speciesId)!
          const sizeBonus = b.radius / sp.baseSize
          const deathEnergy = Math.max(5, (b.energy + 10) * sizeBonus)
          newNutrients.push(...spawnNutrients(b.x, b.y, deathEnergy, sp.color, sizeBonus))
        }
      }

      const liveAntibiotics = [
        ...existingAntibiotics.filter(ab => !absorbedAntibiotics.has(ab.id)),
        ...newAntibiotics,
      ]

      // Biomass accrual — earn based on living population
      const biomassGain = finalAlive.length * 0.02

      // Final bond cleanup: remove any bonds referencing dead cells
      const aliveIds = new Set(finalAlive.map(b => b.id))
      for (const b of newBacteria) aliveIds.add(b.id)
      const finalBonds = [...survivingBonds, ...newBonds].filter(
        bond => aliveIds.has(bond.idA) && aliveIds.has(bond.idB)
      )

      return {
        ...state,
        bacteria: [...finalAlive, ...newBacteria],
        nutrients: liveNutrients,
        antibiotics: liveAntibiotics,
        bonds: finalBonds,
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

    case 'APPLY_COSMETICS': {
      // Apply equipped cosmetics without changing selection
      const equippedColorId = state.store.equipped.colors
      const equippedPatternId = state.store.equipped.patterns
      if (!equippedColorId && !equippedPatternId) return state
      const colorItem = equippedColorId ? STORE_ITEMS.find(i => i.id === equippedColorId) : null
      return {
        ...state,
        bacteria: state.bacteria.map(b => {
          if (b.id !== action.id) return b
          const updates: Partial<BacteriaState> = {}
          if (colorItem?.preview) updates.membraneColor = colorItem.preview
          if (equippedPatternId) updates.movementPattern = equippedPatternId
          return { ...b, ...updates }
        }),
      }
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
        antibiotics: [],
        bonds: [],
        selectedId: null,
        tick: 0,
        camera: { x: WORLD_RADIUS, y: WORLD_RADIUS, zoom: 0.4 },
        paused: false,
        nutrientProfile: state.nutrientProfile,
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

    case 'DROP_NUTRIENTS': {
      if (state.store.equipped.tools !== 'tool-nutrient-dropper') return state
      const dropCost = 3
      if (state.biomass < dropCost) return state
      // Spawn a cluster of 5-8 nutrient particles at the click location
      const dropCount = 5 + Math.floor(Math.random() * 4)
      const dropNutrients: Nutrient[] = []
      for (let i = 0; i < dropCount; i++) {
        const angle = Math.random() * Math.PI * 2
        const spread = Math.random() * 20
        dropNutrients.push({
          id: `n${nutrientId++}`,
          x: action.x + Math.cos(angle) * spread,
          y: action.y + Math.sin(angle) * spread,
          vx: Math.cos(angle) * 0.2,
          vy: Math.sin(angle) * 0.2,
          energy: 8 + Math.random() * 6,
          radius: 3 + Math.random() * 2,
          color: 'oklch(0.82 0.16 90)',
          age: 0,
          maxAge: 500 + Math.floor(Math.random() * 300),
        })
      }
      return {
        ...state,
        nutrients: [...state.nutrients, ...dropNutrients],
        biomass: state.biomass - dropCost,
      }
    }

    case 'DROP_ANTIBIOTICS': {
      if (state.store.equipped.tools !== 'tool-antibiotic-dropper') return state
      const dropCost = 5
      if (state.biomass < dropCost) return state
      const dropCount = 3 + Math.floor(Math.random() * 3)
      const dropAntibiotics: Nutrient[] = []
      for (let i = 0; i < dropCount; i++) {
        const angle = Math.random() * Math.PI * 2
        const spread = Math.random() * 15
        dropAntibiotics.push({
          id: `a${nutrientId++}`,
          x: action.x + Math.cos(angle) * spread,
          y: action.y + Math.sin(angle) * spread,
          vx: Math.cos(angle) * 0.15,
          vy: Math.sin(angle) * 0.15,
          energy: 0,
          radius: 3 + Math.random() * 1.5,
          color: 'oklch(0.65 0.25 25)',
          age: 0,
          maxAge: 800 + Math.floor(Math.random() * 400),
        })
      }
      return {
        ...state,
        antibiotics: [...state.antibiotics, ...dropAntibiotics],
        biomass: state.biomass - dropCost,
      }
    }

    case 'SET_NUTRIENT_PROFILE':
      return { ...state, nutrientProfile: action.profile }

    default:
      return state
  }
}
