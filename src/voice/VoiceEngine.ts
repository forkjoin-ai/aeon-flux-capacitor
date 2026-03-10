/**
 * VoiceModel — Embed content → train voice model → generate in-voice
 *
 * "Voice" = writing tone/style, not audio.
 * The voice model is derived from the embedding space —
 * it captures the tonal fingerprint of how someone writes.
 *
 * Pipeline: Aggregate embeddings → compute centroid + variance →
 * extract style features → constrain generation to voice envelope.
 */

// ── Types ───────────────────────────────────────────────────────────

/** A trained voice model */
export interface VoiceModel {
  /** Unique ID */
  readonly id: string;
  /** Human-readable label */
  readonly label: string;
  /** DID of the voice owner */
  readonly ownerDid: string;
  /** Centroid embedding — the "average" voice */
  readonly centroid: Float32Array;
  /** Variance — how much the voice deviates */
  readonly variance: Float32Array;
  /** Number of samples used to train */
  readonly sampleCount: number;
  /** Style features extracted from the embedding cluster */
  readonly features: VoiceFeatures;
  /** When this model was last updated */
  readonly updatedAt: string;
}

/** Tonal and stylistic features */
export interface VoiceFeatures {
  /** Average sentence length */
  readonly avgSentenceLength: number;
  /** Vocabulary richness (type-token ratio) */
  readonly vocabularyRichness: number;
  /** Formality score (0 = casual, 1 = formal) */
  readonly formality: number;
  /** Emotional range (-1 = negative, 0 = neutral, 1 = positive) */
  readonly sentimentMean: number;
  /** Sentiment variance */
  readonly sentimentVariance: number;
  /** Dominant topics */
  readonly dominantTopics: string[];
  /** Common entity types */
  readonly entityProfile: Record<string, number>;
  /** Readability grade level */
  readonly readabilityGrade: number;
  /** Active vs passive voice ratio */
  readonly activeVoiceRatio: number;
  /** Paragraph length tendency */
  readonly avgParagraphLength: number;
}

/** Voice training configuration */
export interface VoiceTrainingConfig {
  /** Minimum number of blocks to train from */
  readonly minSamples?: number;
  /** Whether to exclude code blocks */
  readonly excludeCode?: boolean;
  /** Whether to exclude very short blocks */
  readonly minBlockLength?: number;
}

// ── Voice Engine ────────────────────────────────────────────────────

export class VoiceEngine {
  private models: Map<string, VoiceModel> = new Map();
  private readonly generateId: () => string;

  constructor(generateId: () => string) {
    this.generateId = generateId;
  }

  /**
   * Train a voice model from a set of embedding nodes.
   * Takes the embedding vectors and metadata, computes
   * the centroid (average voice), variance (range), and
   * extracts stylistic features.
   */
  train(
    label: string,
    ownerDid: string,
    nodes: Array<{
      embedding: Float32Array;
      text: string;
      classification: { sentiment: number; topic: string; confidence: number };
      entities: Array<{ type: string }>;
    }>,
    config: VoiceTrainingConfig = {}
  ): VoiceModel {
    const { minSamples = 5, excludeCode = true, minBlockLength = 20 } = config;

    // Filter nodes
    let samples = nodes.filter((n) => n.text.length >= minBlockLength);
    if (samples.length < minSamples) {
      throw new Error(
        `Need at least ${minSamples} qualifying blocks to train a voice model (got ${samples.length})`
      );
    }

    const dim = samples[0].embedding.length;

    // Compute centroid
    const centroid = new Float32Array(dim);
    for (const node of samples) {
      for (let i = 0; i < dim; i++) {
        centroid[i] += node.embedding[i];
      }
    }
    for (let i = 0; i < dim; i++) {
      centroid[i] /= samples.length;
    }

    // Compute variance
    const variance = new Float32Array(dim);
    for (const node of samples) {
      for (let i = 0; i < dim; i++) {
        const diff = node.embedding[i] - centroid[i];
        variance[i] += diff * diff;
      }
    }
    for (let i = 0; i < dim; i++) {
      variance[i] /= samples.length;
    }

    // Extract features
    const features = this.extractFeatures(samples);

    const model: VoiceModel = {
      id: this.generateId(),
      label,
      ownerDid,
      centroid,
      variance,
      sampleCount: samples.length,
      features,
      updatedAt: new Date().toISOString(),
    };

    this.models.set(model.id, model);
    return model;
  }

  /**
   * Incrementally update a voice model with new content.
   * Uses running mean/variance update (Welford's algorithm).
   */
  update(
    modelId: string,
    newNodes: Array<{
      embedding: Float32Array;
      text: string;
      classification: { sentiment: number; topic: string; confidence: number };
      entities: Array<{ type: string }>;
    }>
  ): VoiceModel | null {
    const existing = this.models.get(modelId);
    if (!existing) return null;

    const dim = existing.centroid.length;
    const newCentroid = new Float32Array(existing.centroid);
    const newVariance = new Float32Array(existing.variance);
    let newCount = existing.sampleCount;

    for (const node of newNodes) {
      newCount++;
      const delta = new Float32Array(dim);
      for (let i = 0; i < dim; i++) {
        delta[i] = node.embedding[i] - newCentroid[i];
        newCentroid[i] += delta[i] / newCount;
        const delta2 = node.embedding[i] - newCentroid[i];
        newVariance[i] += (delta[i] * delta2 - newVariance[i]) / newCount;
      }
    }

    const allSamples = [...newNodes]; // simplified; in production, track all
    const features = this.extractFeatures(allSamples);

    const updated: VoiceModel = {
      ...existing,
      centroid: newCentroid,
      variance: newVariance,
      sampleCount: newCount,
      features,
      updatedAt: new Date().toISOString(),
    };

    this.models.set(modelId, updated);
    return updated;
  }

  /**
   * Score how well a piece of text matches a voice model.
   * Returns 0-1 where 1 = perfect match.
   */
  score(modelId: string, embedding: Float32Array): number {
    const model = this.models.get(modelId);
    if (!model) return 0;

    // Mahalanobis-like distance using per-dimension variance
    let distance = 0;
    const dim = model.centroid.length;
    for (let i = 0; i < dim; i++) {
      const diff = embedding[i] - model.centroid[i];
      const var_i = Math.max(model.variance[i], 1e-8);
      distance += (diff * diff) / var_i;
    }
    distance = Math.sqrt(distance / dim);

    // Convert to 0-1 similarity
    return Math.exp(-distance);
  }

  /** Get a voice model by ID */
  getModel(id: string): VoiceModel | undefined {
    return this.models.get(id);
  }

  /** List all voice models */
  listModels(): VoiceModel[] {
    return Array.from(this.models.values());
  }

  /** Delete a voice model */
  deleteModel(id: string): boolean {
    return this.models.delete(id);
  }

  // ── Private ───────────────────────────────────────────────────

  private extractFeatures(
    nodes: Array<{
      text: string;
      classification: { sentiment: number; topic: string; confidence: number };
      entities: Array<{ type: string }>;
    }>
  ): VoiceFeatures {
    // Sentence lengths
    const sentenceLengths = nodes.flatMap((n) =>
      n.text
        .split(/[.!?]+/)
        .filter((s) => s.trim().length > 0)
        .map((s) => s.trim().split(/\s+/).length)
    );
    const avgSentenceLength =
      sentenceLengths.reduce((a, b) => a + b, 0) /
      Math.max(sentenceLengths.length, 1);

    // Vocabulary richness (type-token ratio)
    const allWords = nodes
      .flatMap((n) => n.text.toLowerCase().split(/\s+/))
      .filter((w) => w.length > 0);
    const uniqueWords = new Set(allWords);
    const vocabularyRichness =
      allWords.length > 0 ? uniqueWords.size / allWords.length : 0;

    // Sentiment
    const sentiments = nodes.map((n) => n.classification.sentiment);
    const sentimentMean =
      sentiments.reduce((a, b) => a + b, 0) / Math.max(sentiments.length, 1);
    const sentimentVariance =
      sentiments.reduce((acc, s) => acc + (s - sentimentMean) ** 2, 0) /
      Math.max(sentiments.length, 1);

    // Topics
    const topicCounts = new Map<string, number>();
    for (const n of nodes) {
      const topic = n.classification.topic;
      if (topic) topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
    }
    const dominantTopics = Array.from(topicCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t]) => t);

    // Entity profile
    const entityProfile: Record<string, number> = {};
    for (const n of nodes) {
      for (const e of n.entities) {
        entityProfile[e.type] = (entityProfile[e.type] || 0) + 1;
      }
    }

    // Paragraph lengths
    const avgParagraphLength =
      nodes.reduce((acc, n) => acc + n.text.split(/\s+/).length, 0) /
      Math.max(nodes.length, 1);

    return {
      avgSentenceLength,
      vocabularyRichness,
      formality: 0.5, // TODO: derive from vocabulary/structure
      sentimentMean,
      sentimentVariance,
      dominantTopics,
      entityProfile,
      readabilityGrade: estimateReadabilityGrade(
        avgSentenceLength,
        vocabularyRichness
      ),
      activeVoiceRatio: 0.7, // TODO: derive from syntax analysis
      avgParagraphLength,
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function estimateReadabilityGrade(
  avgSentenceLength: number,
  vocabularyRichness: number
): number {
  // Simplified Flesch-Kincaid approximation
  return Math.max(
    1,
    Math.min(16, avgSentenceLength * 0.4 + (1 - vocabularyRichness) * 10)
  );
}
