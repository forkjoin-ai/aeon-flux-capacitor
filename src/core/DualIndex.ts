/**
 * DualIndex — The Pensieve model for the editor
 *
 * Two indexes. Sampled together at render.
 *
 * INDEX 1: AMYGDALA (Internal / Fast / Emotional)
 * ─────────────────────────────────────────────
 * The somatic tagger. Works in real-time as you type.
 * Stores: sentiment, valence, arousal, dominance,
 *         emotional resonance predictions, intensity.
 * Indexed by: block ID, emotion tag, intensity range.
 * Purpose: "How does this feel?"
 *
 * INDEX 2: HIPPOCAMPUS (External / Rich / Contextual)
 * ─────────────────────────────────────────────
 * The episodic memory. Builds deep context over time.
 * Stores: semantic embedding, entity graph, relationships,
 *         temporal snapshots, backlinks, cross-document connections.
 * Indexed by: embedding similarity, entity, temporal range.
 * Purpose: "What does this mean?"
 *
 * AT RENDER TIME:
 * Both indexes are sampled for every block. The projection
 * surface (text, audio, spatial, reading) interpolates them:
 *   - Text projection: meaning weighted, emotion for tone
 *   - Audio projection: emotion weighted (pitch, tempo, timbre)
 *   - Spatial projection: meaning for position, emotion for color
 *   - Reading projection: meaning for flow, emotion for pacing
 */

// ── Amygdala Index (Fast Emotional Tagging) ─────────────────────────

export interface AmygdalaEntry {
  /** Block ID */
  readonly arousal: number;
  /** Valence: negative ↔ positive (-1 to 1) */
  readonly blockId: string;
  /** Arousal: calming ↔ activating (0 to 1) */
  readonly confidence: number;
  /** Dominance: submissive ↔ dominant (0 to 1) */
  readonly dominance: number;
  /** Primary emotion tag */
  readonly emotion: string;
  /** Emotional intensity (0-1) */
  readonly intensity: number;
  /** Somatic markers — body-feel associations */
  readonly somaticMarkers: SomaticMarker[];
  /** When this was last tagged */
  readonly taggedAt: number;
  /** Tag confidence (0-1) */
  readonly valence: number;
}

export interface SomaticMarker {
  /** Marker type */
  readonly type:
    | 'tension'
    | 'warmth'
    | 'heaviness'
    | 'lightness'
    | 'constriction'
    | 'expansion'
    | 'energy'
    | 'calm';
  /** Intensity (0-1) */
  readonly intensity: number;
  /** Body region (for spatial mapping) */
  readonly region?:
    | 'chest'
    | 'throat'
    | 'gut'
    | 'head'
    | 'limbs'
    | 'whole-body';
}

// ── Hippocampus Index (Rich Contextual Embedding) ───────────────────

export interface HippocampusEntry {
  /** Block ID */
  readonly blockId: string;
  /** Semantic embedding vector */
  readonly claims: string[];
  /** Entity references */
  readonly crossDocLinks: CrossDocLink[];
  /** Relationship edges to other blocks */
  readonly edges: SemanticEdge[];
  /** Cross-document connections */
  readonly embedding: Float32Array;
  /** Temporal metadata */
  readonly entities: EntityRef[];
  /** Topic classification */
  readonly temporal: TemporalMeta;
  /** Factual claims made in this block */
  readonly topics: string[];
}

export interface EntityRef {
  readonly type: string;
  readonly entityId: string;
  readonly name: string;
  readonly span: [number, number]; // character offsets within block text
}

export interface SemanticEdge {
  readonly relationship:
    | 'supports'
    | 'contradicts'
    | 'extends'
    | 'references'
    | 'precedes'
    | 'follows';
  readonly strength: number;
  readonly targetBlockId: string; // 0-1
}

export interface CrossDocLink {
  readonly blockId: string;
  readonly documentId: string;
  readonly relationship: string;
  readonly similarity: number;
}

export interface TemporalMeta {
  readonly createdAt: number;
  readonly lastModifiedAt: number;
  readonly lifespan: 'ephemeral' | 'transient' | 'durable' | 'evergreen';
  readonly modificationCount: number;
}

// ── Render Sample (What the projection surfaces consume) ────────────

export interface RenderSample {
  /** Block ID */
  readonly amygdala: AmygdalaEntry;
  /** Amygdala data */
  readonly blockId: string;
  /** Hippocampus data */
  readonly hippocampus: HippocampusEntry;
  /** Interpolated values for convenience */
  readonly interpolated: InterpolatedSample;
}

export interface InterpolatedSample {
  /** Blended color (emotion → hue, meaning → saturation) */
  readonly audioHint: {
    pitch: number; // Hz modifier
    tempo: number; // BPM modifier
    timbre: number; // 0=warm, 1=bright
    volume: number; // 0-1
  };
  /** Rendering priority (higher = more prominent) */
  readonly color: string;
  /** Suggested reading pace (words per minute adjustment) */
  readonly paceModifier: number;
  /** Spatial position hint (from embedding, colored by emotion) */
  readonly priority: number;
  /** Audio parameter hints */
  readonly spatialHint: [number, number, number];
}

// ── Dual Index Engine ───────────────────────────────────────────────

export interface DualIndexConfig {
  /** Amygdala tag function: takes text, returns emotional tags */
  readonly blendRatio?: number;
  /** Hippocampus embed function: takes text, returns embedding + entities */
  readonly embed?: (text: string) => Promise<{
    claims: string[];
    embedding: Float32Array;
    entities: EntityRef[];
    topics: string[];
  }>;
  /** Blend ratio: 0 = pure hippocampus, 1 = pure amygdala */
  readonly tagEmotions?: (
    text: string
  ) => Promise<Omit<AmygdalaEntry, 'blockId' | 'taggedAt'>>;
}

export class DualIndex {
  private amygdala: Map<string, AmygdalaEntry> = new Map();
  private hippocampus: Map<string, HippocampusEntry> = new Map();
  private config: DualIndexConfig;
  private listeners: Set<(blockId: string, sample: RenderSample) => void> =
    new Set();

  constructor(config?: DualIndexConfig) {
    this.config = config ?? {};
  }

  // ── Index 1: Amygdala ─────────────────────────────────────────

  /**
   * Tag a block with emotional data. Fast path — runs on every keystroke.
   */
  async tagAmygdala(blockId: string, text: string): Promise<AmygdalaEntry> {
    let entry: AmygdalaEntry;

    if (this.config.tagEmotions) {
      const result = await this.config.tagEmotions(text);
      entry = { ...result, blockId, taggedAt: Date.now() };
    } else {
      entry = this.heuristicAmygdala(blockId, text);
    }

    this.amygdala.set(blockId, entry);
    this.notifyIfBothExist(blockId);
    return entry;
  }

  /**
   * Set amygdala entry directly (if you already have the data).
   */
  setAmygdala(entry: AmygdalaEntry): void {
    this.amygdala.set(entry.blockId, entry);
    this.notifyIfBothExist(entry.blockId);
  }

  /**
   * Get amygdala entry for a block.
   */
  getAmygdala(blockId: string): AmygdalaEntry | undefined {
    return this.amygdala.get(blockId);
  }

  // ── Index 2: Hippocampus ──────────────────────────────────────

  /**
   * Index a block with contextual data. Rich path — debounced.
   */
  async indexHippocampus(
    blockId: string,
    text: string,
    edges?: SemanticEdge[],
    crossDocLinks?: CrossDocLink[],
    temporal?: TemporalMeta
  ): Promise<HippocampusEntry> {
    let embedding: Float32Array;
    let entities: EntityRef[] = [];
    let topics: string[] = [];
    let claims: string[] = [];

    if (this.config.embed) {
      const result = await this.config.embed(text);
      embedding = result.embedding;
      entities = result.entities;
      topics = result.topics;
      claims = result.claims;
    } else {
      // Placeholder embedding
      embedding = new Float32Array(384);
      const words = text.toLowerCase().split(/\s+/);
      for (let i = 0; i < Math.min(words.length, 384); i++) {
        embedding[i] = this.simpleHash(words[i]) / 2147483647;
      }
    }

    const entry: HippocampusEntry = {
      blockId,
      embedding,
      entities,
      edges: edges ?? [],
      crossDocLinks: crossDocLinks ?? [],
      temporal: temporal ?? {
        createdAt: Date.now(),
        lastModifiedAt: Date.now(),
        modificationCount: 1,
        lifespan: 'durable',
      },
      topics,
      claims,
    };

    this.hippocampus.set(blockId, entry);
    this.notifyIfBothExist(blockId);
    return entry;
  }

  /**
   * Set hippocampus entry directly.
   */
  setHippocampus(entry: HippocampusEntry): void {
    this.hippocampus.set(entry.blockId, entry);
    this.notifyIfBothExist(entry.blockId);
  }

  /**
   * Get hippocampus entry for a block.
   */
  getHippocampus(blockId: string): HippocampusEntry | undefined {
    return this.hippocampus.get(blockId);
  }

  // ── Render Sampling ───────────────────────────────────────────

  /**
   * Sample both indexes for a block. This is what projection surfaces call.
   */
  sample(blockId: string): RenderSample | null {
    const a = this.amygdala.get(blockId);
    const h = this.hippocampus.get(blockId);

    if (!a && !h) return null;

    const amygdala = a ?? this.defaultAmygdala(blockId);
    const hippocampus = h ?? this.defaultHippocampus(blockId);
    const interpolated = this.interpolate(amygdala, hippocampus);

    return { blockId, amygdala, hippocampus, interpolated };
  }

  /**
   * Sample all indexed blocks (for full-document rendering).
   */
  sampleAll(): RenderSample[] {
    const allBlockIds = new Set([
      ...this.amygdala.keys(),
      ...this.hippocampus.keys(),
    ]);

    const samples: RenderSample[] = [];
    for (const blockId of allBlockIds) {
      const sample = this.sample(blockId);
      if (sample) samples.push(sample);
    }

    return samples;
  }

  /**
   * Query the amygdala index by emotional criteria.
   */
  queryAmygdala(filter: {
    emotion?: string;
    minIntensity?: number;
    minValence?: number;
    maxValence?: number;
  }): AmygdalaEntry[] {
    const results: AmygdalaEntry[] = [];

    for (const entry of this.amygdala.values()) {
      if (filter.emotion && entry.emotion !== filter.emotion) continue;
      if (
        filter.minIntensity !== undefined &&
        entry.intensity < filter.minIntensity
      )
        continue;
      if (filter.minValence !== undefined && entry.valence < filter.minValence)
        continue;
      if (filter.maxValence !== undefined && entry.valence > filter.maxValence)
        continue;
      results.push(entry);
    }

    return results;
  }

  /**
   * Query the hippocampus index by embedding similarity.
   */
  queryHippocampus(
    queryEmbedding: Float32Array,
    options?: { limit?: number; minSimilarity?: number }
  ): Array<{ entry: HippocampusEntry; similarity: number }> {
    const limit = options?.limit ?? 10;
    const minSimilarity = options?.minSimilarity ?? 0.5;

    const results: Array<{ entry: HippocampusEntry; similarity: number }> = [];

    for (const entry of this.hippocampus.values()) {
      const sim = this.cosine(queryEmbedding, entry.embedding);
      if (sim >= minSimilarity) {
        results.push({ entry, similarity: sim });
      }
    }

    return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }

  /**
   * Listen for render samples (whenever both indexes update for a block).
   */
  onSample(
    listener: (blockId: string, sample: RenderSample) => void
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Get stats about both indexes.
   */
  getStats(): {
    amygdalaSize: number;
    hippocampusSize: number;
    bothIndexed: number;
    amygdalaOnly: number;
    hippocampusOnly: number;
  } {
    const amygdalaIds = new Set(this.amygdala.keys());
    const hippocampusIds = new Set(this.hippocampus.keys());

    let bothIndexed = 0,
      amygdalaOnly = 0,
      hippocampusOnly = 0;
    for (const id of amygdalaIds) {
      if (hippocampusIds.has(id)) bothIndexed++;
      else amygdalaOnly++;
    }
    for (const id of hippocampusIds) {
      if (!amygdalaIds.has(id)) hippocampusOnly++;
    }

    return {
      amygdalaSize: this.amygdala.size,
      hippocampusSize: this.hippocampus.size,
      bothIndexed,
      amygdalaOnly,
      hippocampusOnly,
    };
  }

  // ── Private: Interpolation ────────────────────────────────────

  private interpolate(
    a: AmygdalaEntry,
    h: HippocampusEntry
  ): InterpolatedSample {
    const blend = this.config.blendRatio ?? 0.4; // slight meaning bias by default

    // Color: hue from emotion, saturation from embedding density
    const hue = this.emotionToHue(a.emotion);
    const saturation = 30 + a.intensity * 50;
    const lightness = 35 + (1 - a.arousal) * 25;
    const color = `hsla(${hue}, ${saturation}%, ${lightness}%, 0.5)`;

    // Priority: high emotion OR many connections = high priority
    const emotionPriority = a.intensity * a.arousal;
    const connectionPriority = Math.min(1, h.edges.length / 5);
    const priority = emotionPriority * blend + connectionPriority * (1 - blend);

    // Pace: arousal increases pace, complexity (entity density) decreases it
    const entityDensity = Math.min(1, h.entities.length / 10);
    const paceModifier = 1 + (a.arousal - 0.5) * 0.3 - entityDensity * 0.2;

    // Spatial: embedding → position, emotion → color (already done)
    const spatialHint: [number, number, number] = [
      h.embedding.length > 0 ? h.embedding[0] * 10 : 0,
      h.embedding.length > 1 ? h.embedding[1] * 10 : 0,
      h.embedding.length > 2 ? h.embedding[2] * 10 : 0,
    ];

    // Audio: emotion drives everything
    const audioHint = {
      pitch: 200 + a.valence * 100 + a.arousal * 200, // higher valence & arousal = higher pitch
      tempo: 80 + a.arousal * 80, // higher arousal = faster tempo
      timbre: a.valence > 0 ? 0.7 : 0.3, // positive = brighter, negative = warmer
      volume: 0.3 + a.intensity * 0.7,
    };

    return { color, priority, paceModifier, spatialHint, audioHint };
  }

  private emotionToHue(emotion: string): number {
    const hueMap: Record<string, number> = {
      joy: 50,
      sadness: 220,
      anger: 0,
      fear: 270,
      surprise: 35,
      disgust: 90,
      trust: 170,
      anticipation: 30,
      curiosity: 190,
      confusion: 240,
      awe: 280,
      gratitude: 140,
      hope: 160,
      pride: 45,
      guilt: 300,
      shame: 310,
      nostalgia: 35,
      empowerment: 55,
      vulnerability: 250,
      neutral: 200,
    };
    return hueMap[emotion] ?? 200;
  }

  private defaultAmygdala(blockId: string): AmygdalaEntry {
    return {
      blockId,
      valence: 0,
      arousal: 0.3,
      dominance: 0.5,
      emotion: 'neutral',
      intensity: 0.2,
      somaticMarkers: [],
      taggedAt: Date.now(),
      confidence: 0.1,
    };
  }

  private defaultHippocampus(blockId: string): HippocampusEntry {
    return {
      blockId,
      embedding: new Float32Array(384),
      entities: [],
      edges: [],
      crossDocLinks: [],
      temporal: {
        createdAt: Date.now(),
        lastModifiedAt: Date.now(),
        modificationCount: 0,
        lifespan: 'durable',
      },
      topics: [],
      claims: [],
    };
  }

  private heuristicAmygdala(blockId: string, text: string): AmygdalaEntry {
    const hasExclamation = text.includes('!');
    const hasQuestion = text.includes('?');
    const words = text.toLowerCase().split(/\s+/);
    const length = words.length;

    const positiveWords = new Set([
      'love',
      'great',
      'amazing',
      'beautiful',
      'wonderful',
      'happy',
      'joy',
      'hope',
    ]);
    const negativeWords = new Set([
      'hate',
      'terrible',
      'awful',
      'sad',
      'angry',
      'fear',
      'pain',
      'suffer',
    ]);

    let pos = 0,
      neg = 0;
    for (const w of words) {
      if (positiveWords.has(w)) pos++;
      if (negativeWords.has(w)) neg++;
    }

    const valence = length > 0 ? (pos - neg) / Math.max(1, pos + neg) : 0;
    const arousal = hasExclamation ? 0.7 : hasQuestion ? 0.5 : 0.3;
    const intensity = Math.min(1, ((pos + neg) / Math.max(1, length)) * 10);

    return {
      blockId,
      valence,
      arousal,
      dominance: 0.5,
      emotion: valence > 0.2 ? 'joy' : valence < -0.2 ? 'sadness' : 'neutral',
      intensity,
      somaticMarkers: [],
      taggedAt: Date.now(),
      confidence: 0.3,
    };
  }

  private cosine(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;
    let dot = 0,
      magA = 0,
      magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return Math.abs(hash);
  }

  private notifyIfBothExist(blockId: string): void {
    if (this.amygdala.has(blockId) && this.hippocampus.has(blockId)) {
      const renderSample = this.sample(blockId);
      if (renderSample) {
        for (const listener of this.listeners) {
          listener(blockId, renderSample);
        }
      }
    }
  }
}
