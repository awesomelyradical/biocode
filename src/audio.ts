/**
 * @module audio
 *
 * Procedural audio engine built on the Web Audio API.
 *
 * Each "music" store item maps to a synthesiser function that creates a unique
 * generative soundscape using oscillators, filters, LFOs, and noise buffers.
 * No audio files are used — everything is synthesised at runtime.
 *
 * Supported ambience modes:
 *  - `music-ambient-hum`  — deep resonant drone with slow LFO modulation
 *  - `music-heartbeat`    — lub-dub rhythm at 72 BPM via scheduled gain envelopes
 *  - `music-static`       — band-pass-filtered white noise with frequency sweep
 *  - `music-synth-wave`   — detuned sawtooth pad chord with filter LFO
 *  - `music-nature`       — brown-noise rain + band-pass wind with slow modulation
 *
 * Public API:
 *  - `playMusic(itemId)` — start (or switch to) the given ambience
 *  - `stopMusic()`       — silence all audio and release nodes
 */

// Procedural audio engine using Web Audio API
// Each music item generates a unique synthesized ambience

let ctx: AudioContext | null = null
let masterGain: GainNode | null = null
let activeNodes: AudioNode[] = []
let activeId: string | null = null

/** Lazily create (or resume) the shared AudioContext + master gain node. */
function getContext() {
  if (!ctx) {
    ctx = new AudioContext()
    masterGain = ctx.createGain()
    masterGain.gain.value = 0.3
    masterGain.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') ctx.resume()
  return { ctx, masterGain: masterGain! }
}

/** Stop and disconnect all currently active audio nodes. */
function cleanup() {
  for (const node of activeNodes) {
    try {
      if ('stop' in node && typeof (node as OscillatorNode).stop === 'function') {
        (node as OscillatorNode).stop()
      }
      node.disconnect()
    } catch { /* already stopped */ }
  }
  activeNodes = []
}

/** Create a looping white-noise buffer source (used by Static and Nature). */
function createWhiteNoise(ac: AudioContext): AudioBufferSourceNode {
  const bufferSize = ac.sampleRate * 2
  const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1
  }
  const source = ac.createBufferSource()
  source.buffer = buffer
  source.loop = true
  return source
}

// ── Ambient Hum: deep resonant drone with slow modulation ──
function startAmbientHum(ac: AudioContext, dest: AudioNode) {
  const osc1 = ac.createOscillator()
  osc1.type = 'sine'
  osc1.frequency.value = 55 // low A

  const osc2 = ac.createOscillator()
  osc2.type = 'sine'
  osc2.frequency.value = 82.5 // fifth above

  const lfo = ac.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.value = 0.1 // very slow
  const lfoGain = ac.createGain()
  lfoGain.gain.value = 5
  lfo.connect(lfoGain)
  lfoGain.connect(osc1.frequency)

  const gain1 = ac.createGain()
  gain1.gain.value = 0.4
  const gain2 = ac.createGain()
  gain2.gain.value = 0.2

  const filter = ac.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 200
  filter.Q.value = 2

  osc1.connect(gain1).connect(filter)
  osc2.connect(gain2).connect(filter)
  filter.connect(dest)

  osc1.start()
  osc2.start()
  lfo.start()

  activeNodes.push(osc1, osc2, lfo, lfoGain, gain1, gain2, filter)
}

// ── Heartbeat: rhythmic low-frequency thumps ──
function startHeartbeat(ac: AudioContext, dest: AudioNode) {
  const osc = ac.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = 40

  const ampGain = ac.createGain()
  ampGain.gain.value = 0

  // LFO to create the "lub-dub" rhythm
  const scriptInterval = 60 / 72 // 72 BPM heartbeat
  const now = ac.currentTime
  // Schedule repeating heartbeat pattern
  function scheduleBeats(startTime: number, duration: number) {
    let t = startTime
    while (t < startTime + duration) {
      // Lub
      ampGain.gain.setValueAtTime(0, t)
      ampGain.gain.linearRampToValueAtTime(0.6, t + 0.04)
      ampGain.gain.exponentialRampToValueAtTime(0.01, t + 0.2)
      // Dub (slightly softer, slightly delayed)
      const dubTime = t + 0.25
      ampGain.gain.setValueAtTime(0.01, dubTime)
      ampGain.gain.linearRampToValueAtTime(0.35, dubTime + 0.03)
      ampGain.gain.exponentialRampToValueAtTime(0.01, dubTime + 0.15)
      t += scriptInterval
    }
  }
  scheduleBeats(now, 120) // schedule 2 minutes ahead

  const filter = ac.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 80

  osc.connect(ampGain).connect(filter).connect(dest)
  osc.start()

  activeNodes.push(osc, ampGain, filter)

  // Reschedule periodically
  const interval = setInterval(() => {
    if (!ctx || activeId !== 'music-heartbeat') {
      clearInterval(interval)
      return
    }
    scheduleBeats(ac.currentTime, 120)
  }, 90_000)
}

// ── Static: filtered white noise crackle ──
function startStatic(ac: AudioContext, dest: AudioNode) {
  const noise = createWhiteNoise(ac)

  const bandpass = ac.createBiquadFilter()
  bandpass.type = 'bandpass'
  bandpass.frequency.value = 3000
  bandpass.Q.value = 0.5

  const gain = ac.createGain()
  gain.gain.value = 0.15

  // Slow modulation of the filter frequency for variation
  const lfo = ac.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.value = 0.3
  const lfoGain = ac.createGain()
  lfoGain.gain.value = 2000
  lfo.connect(lfoGain)
  lfoGain.connect(bandpass.frequency)

  noise.connect(bandpass).connect(gain).connect(dest)
  noise.start()
  lfo.start()

  activeNodes.push(noise, bandpass, gain, lfo, lfoGain)
}

// ── Synth Wave: retro detuned pad ──
function startSynthWave(ac: AudioContext, dest: AudioNode) {
  const notes = [65.41, 82.41, 98.0, 130.81] // C2, E2, G2, C3
  const gains: GainNode[] = []

  for (const freq of notes) {
    const osc1 = ac.createOscillator()
    osc1.type = 'sawtooth'
    osc1.frequency.value = freq

    const osc2 = ac.createOscillator()
    osc2.type = 'sawtooth'
    osc2.frequency.value = freq * 1.005 // slight detune

    const g = ac.createGain()
    g.gain.value = 0.06
    gains.push(g)

    osc1.connect(g)
    osc2.connect(g)
    osc1.start()
    osc2.start()

    activeNodes.push(osc1, osc2, g)
  }

  const filter = ac.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 400
  filter.Q.value = 3

  // Slow filter sweep
  const lfo = ac.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.value = 0.05
  const lfoGain = ac.createGain()
  lfoGain.gain.value = 300
  lfo.connect(lfoGain)
  lfoGain.connect(filter.frequency)
  lfo.start()

  const masterG = ac.createGain()
  masterG.gain.value = 0.5

  for (const g of gains) g.connect(filter)
  filter.connect(masterG).connect(dest)

  activeNodes.push(filter, lfo, lfoGain, masterG)
}

// ── Nature: brown noise (rain) + wind howl ──
function startNature(ac: AudioContext, dest: AudioNode) {
  // Brown noise for rain
  const noise = createWhiteNoise(ac)
  const brownFilter = ac.createBiquadFilter()
  brownFilter.type = 'lowpass'
  brownFilter.frequency.value = 400
  const rainGain = ac.createGain()
  rainGain.gain.value = 0.35

  noise.connect(brownFilter).connect(rainGain).connect(dest)
  noise.start()

  // Wind: filtered noise with slow modulation
  const wind = createWhiteNoise(ac)
  const windBand = ac.createBiquadFilter()
  windBand.type = 'bandpass'
  windBand.frequency.value = 600
  windBand.Q.value = 1.5

  const windLfo = ac.createOscillator()
  windLfo.type = 'sine'
  windLfo.frequency.value = 0.15
  const windLfoGain = ac.createGain()
  windLfoGain.gain.value = 300
  windLfo.connect(windLfoGain)
  windLfoGain.connect(windBand.frequency)

  const windGain = ac.createGain()
  windGain.gain.value = 0.12

  wind.connect(windBand).connect(windGain).connect(dest)
  wind.start()
  windLfo.start()

  activeNodes.push(noise, brownFilter, rainGain, wind, windBand, windLfo, windLfoGain, windGain)
}

// ── Public API ──

/**
 * Start or switch to the given music/ambience mode.
 * Pass `null` to stop playback. If the requested item is already playing, no-op.
 */
export function playMusic(itemId: string | null) {
  if (itemId === activeId) return
  cleanup()
  activeId = itemId
  if (!itemId) return

  const { ctx: ac, masterGain: dest } = getContext()

  switch (itemId) {
    case 'music-ambient-hum':
      startAmbientHum(ac, dest)
      break
    case 'music-heartbeat':
      startHeartbeat(ac, dest)
      break
    case 'music-static':
      startStatic(ac, dest)
      break
    case 'music-synth-wave':
      startSynthWave(ac, dest)
      break
    case 'music-nature':
      startNature(ac, dest)
      break
  }
}

/** Stop all audio playback and release resources. */
export function stopMusic() {
  cleanup()
  activeId = null
}
