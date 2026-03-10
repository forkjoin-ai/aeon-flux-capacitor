/**
 * AudioProjection — Embeddings projected as sound
 *
 * Text is one projection surface. Audio is another.
 * Same embedding vectors, different renderer.
 *
 * Maps embedding dimensions to audio parameters:
 *   - Centroid position → pitch
 *   - Variance → timbre/texture
 *   - Sentiment → major/minor tonality
 *   - Semantic distance between blocks → rhythm/spacing
 *   - Entity density → harmonic complexity
 *   - Classification confidence → volume/presence
 *
 * The document becomes a composition. Each block is a phrase.
 * Navigate by listening. Edit by ear.
 */

// ── Types ───────────────────────────────────────────────────────────

export interface AudioProjectionConfig {
  /** Base frequency in Hz (default: 220 = A3) */
  readonly baseFrequency?: number;
  /** Tempo in BPM (default: 72) */
  readonly tempo?: number;
  /** Scale to quantize pitches to */
  readonly scale?: MusicalScale;
  /** Master volume (0-1) */
  readonly volume?: number;
  /** Reverb amount (0-1) */
  readonly reverb?: number;
  /** Whether to auto-play on document load */
  readonly autoPlay?: boolean;
}

export type MusicalScale =
  | 'chromatic'
  | 'major'
  | 'minor'
  | 'pentatonic'
  | 'dorian'
  | 'mixolydian'
  | 'whole-tone'
  | 'blues';

/** Audio representation of a single block */
export interface BlockVoicing {
  /** Block ID */
  readonly blockId: string;
  /** Pitch in Hz */
  readonly pitch: number;
  /** Duration in seconds */
  readonly duration: number;
  /** Volume (0-1) */
  readonly volume: number;
  /** Pan (-1 left, 0 center, 1 right) */
  readonly pan: number;
  /** Waveform type */
  readonly waveform: OscillatorType;
  /** Envelope */
  readonly envelope: {
    attack: number;
    decay: number;
    sustain: number;
    release: number;
  };
  /** Filter cutoff (Hz) */
  readonly filterCutoff: number;
  /** Harmonic overtones */
  readonly harmonics: number[];
}

// ── Scale Intervals ─────────────────────────────────────────────────

const SCALE_INTERVALS: Record<MusicalScale, number[]> = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  'whole-tone': [0, 2, 4, 6, 8, 10],
  blues: [0, 3, 5, 6, 7, 10],
};

// ── Audio Projection Engine ─────────────────────────────────────────

export class AudioProjection {
  private ctx: AudioContext | null = null;
  private config: Required<AudioProjectionConfig>;
  private masterGain: GainNode | null = null;
  private reverbNode: ConvolverNode | null = null;
  private isPlaying = false;
  private scheduledNodes: AudioScheduledSourceNode[] = [];

  constructor(config: AudioProjectionConfig = {}) {
    this.config = {
      baseFrequency: config.baseFrequency ?? 220,
      tempo: config.tempo ?? 72,
      scale: config.scale ?? 'pentatonic',
      volume: config.volume ?? 0.6,
      reverb: config.reverb ?? 0.3,
      autoPlay: config.autoPlay ?? false,
    };
  }

  /**
   * Project a document's embeddings into audio.
   * Each block becomes a musical phrase.
   */
  projectDocument(
    blocks: Array<{
      id: string;
      embedding: Float32Array;
      text: string;
      classification: { sentiment: number; topic: string; confidence: number };
      entities: Array<{ type: string }>;
    }>
  ): BlockVoicing[] {
    return blocks.map((block, index) =>
      this.projectBlock(block, index, blocks.length)
    );
  }

  /**
   * Project a single block's embedding into audio parameters.
   */
  projectBlock(
    block: {
      id: string;
      embedding: Float32Array;
      text: string;
      classification: { sentiment: number; topic: string; confidence: number };
      entities: Array<{ type: string }>;
    },
    position: number,
    totalBlocks: number
  ): BlockVoicing {
    const emb = block.embedding;
    const dim = emb.length;

    // Pitch: derived from first few embedding dimensions
    const pitchFactor =
      dim > 0
        ? (emb[0] + emb[Math.floor(dim / 4)] + emb[Math.floor(dim / 2)]) / 3
        : 0;
    const rawPitch = this.config.baseFrequency * Math.pow(2, pitchFactor * 2);
    const pitch = this.quantizeToScale(rawPitch);

    // Duration: text length → phrase length, mapped to beat subdivisions
    const beatDuration = 60 / this.config.tempo;
    const wordCount = block.text.split(/\s+/).length;
    const beats = Math.max(1, Math.min(8, Math.ceil(wordCount / 10)));
    const duration = beats * beatDuration;

    // Volume: confidence drives presence
    const volume = 0.3 + block.classification.confidence * 0.7;

    // Pan: position in document maps to stereo field
    const pan =
      totalBlocks > 1
        ? (position / (totalBlocks - 1)) * 2 - 1 // -1 to 1
        : 0;

    // Waveform: sentiment drives timbre
    const sentiment = block.classification.sentiment;
    const waveform: OscillatorType =
      sentiment > 0.3
        ? 'sine' // positive → warm sine
        : sentiment < -0.3
        ? 'sawtooth' // negative → edgy sawtooth
        : 'triangle'; // neutral → soft triangle

    // Envelope: entity density drives attack
    const entityDensity = block.entities.length / Math.max(wordCount, 1);
    const envelope = {
      attack: 0.05 + (1 - entityDensity) * 0.2,
      decay: 0.1 + entityDensity * 0.3,
      sustain: 0.4 + block.classification.confidence * 0.3,
      release: 0.3 + (1 - Math.abs(sentiment)) * 0.5,
    };

    // Filter: embedding variance → brightness
    const variance = this.computeVariance(emb);
    const filterCutoff = 200 + variance * 8000;

    // Harmonics: embedding magnitude → overtone richness
    const magnitude = this.computeMagnitude(emb);
    const harmonicCount = Math.min(6, Math.max(1, Math.round(magnitude * 4)));
    const harmonics = Array.from(
      { length: harmonicCount },
      (_, i) => 1 / (i + 2)
    );

    return {
      blockId: block.id,
      pitch,
      duration,
      volume,
      pan,
      waveform,
      envelope,
      filterCutoff,
      harmonics,
    };
  }

  /**
   * Play the audio projection using Web Audio API.
   */
  async play(voicings: BlockVoicing[]): Promise<void> {
    if (this.isPlaying) this.stop();

    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.config.volume;
    this.masterGain.connect(this.ctx.destination);

    this.isPlaying = true;
    let startTime = this.ctx.currentTime + 0.1;

    for (const voicing of voicings) {
      if (!this.isPlaying) break;
      this.scheduleVoicing(voicing, startTime);
      startTime += voicing.duration;
    }
  }

  /**
   * Play a single block's voicing (for preview/navigation).
   */
  async playBlock(voicing: BlockVoicing): Promise<void> {
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.config.volume;
      this.masterGain.connect(this.ctx.destination);
    }

    this.scheduleVoicing(voicing, this.ctx.currentTime + 0.05);
  }

  /**
   * Stop playback.
   */
  stop(): void {
    this.isPlaying = false;
    for (const node of this.scheduledNodes) {
      try {
        node.stop();
      } catch (_) {
        /* already stopped */
      }
    }
    this.scheduledNodes = [];
  }

  /**
   * Clean up.
   */
  destroy(): void {
    this.stop();
    this.ctx?.close();
    this.ctx = null;
  }

  // ── Private ───────────────────────────────────────────────────

  private scheduleVoicing(voicing: BlockVoicing, startTime: number): void {
    if (!this.ctx || !this.masterGain) return;

    // Panner
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = voicing.pan;
    panner.connect(this.masterGain);

    // Filter
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = voicing.filterCutoff;
    filter.Q.value = 1;
    filter.connect(panner);

    // Envelope gain
    const envGain = this.ctx.createGain();
    envGain.gain.setValueAtTime(0, startTime);
    envGain.gain.linearRampToValueAtTime(
      voicing.volume,
      startTime + voicing.envelope.attack
    );
    envGain.gain.linearRampToValueAtTime(
      voicing.volume * voicing.envelope.sustain,
      startTime + voicing.envelope.attack + voicing.envelope.decay
    );
    envGain.gain.setValueAtTime(
      voicing.volume * voicing.envelope.sustain,
      startTime + voicing.duration - voicing.envelope.release
    );
    envGain.gain.linearRampToValueAtTime(0, startTime + voicing.duration);
    envGain.connect(filter);

    // Fundamental oscillator
    const osc = this.ctx.createOscillator();
    osc.type = voicing.waveform;
    osc.frequency.value = voicing.pitch;
    osc.connect(envGain);
    osc.start(startTime);
    osc.stop(startTime + voicing.duration + 0.1);
    this.scheduledNodes.push(osc);

    // Harmonics
    for (let i = 0; i < voicing.harmonics.length; i++) {
      const harmOsc = this.ctx.createOscillator();
      harmOsc.type = 'sine';
      harmOsc.frequency.value = voicing.pitch * (i + 2);

      const harmGain = this.ctx.createGain();
      harmGain.gain.value = voicing.harmonics[i] * 0.3;
      harmGain.connect(envGain);
      harmOsc.connect(harmGain);
      harmOsc.start(startTime);
      harmOsc.stop(startTime + voicing.duration + 0.1);
      this.scheduledNodes.push(harmOsc);
    }
  }

  private quantizeToScale(frequency: number): number {
    const intervals = SCALE_INTERVALS[this.config.scale];
    const base = this.config.baseFrequency;

    // Find the nearest note in the scale
    const semitones = 12 * Math.log2(frequency / base);
    const octave = Math.floor(semitones / 12);
    const remainder = ((semitones % 12) + 12) % 12;

    // Find closest interval
    let closest = intervals[0];
    let minDist = Infinity;
    for (const interval of intervals) {
      const dist = Math.abs(remainder - interval);
      if (dist < minDist) {
        minDist = dist;
        closest = interval;
      }
    }

    return base * Math.pow(2, octave + closest / 12);
  }

  private computeVariance(emb: Float32Array): number {
    if (emb.length === 0) return 0;
    let mean = 0;
    for (let i = 0; i < emb.length; i++) mean += emb[i];
    mean /= emb.length;

    let variance = 0;
    for (let i = 0; i < emb.length; i++) {
      const diff = emb[i] - mean;
      variance += diff * diff;
    }
    return Math.sqrt(variance / emb.length);
  }

  private computeMagnitude(emb: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < emb.length; i++) sum += emb[i] * emb[i];
    return Math.sqrt(sum);
  }
}
