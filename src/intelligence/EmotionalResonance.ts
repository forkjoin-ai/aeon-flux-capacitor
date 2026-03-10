/**
 * EmotionalResonance — Predict how content lands emotionally
 *
 * Every editor knows what you wrote. No editor knows how it
 * will make someone feel. Not sentiment analysis of the text —
 * predicted emotional response of the READER.
 *
 * "This paragraph will make 40% of readers feel anxious."
 * "This sentence lands differently for someone who disagrees."
 * "The conclusion will leave readers hopeful, but not convinced."
 *
 * We can do this because we have emotional intelligence
 * as a first-class primitive. It's what Affectively IS.
 *
 * Uses: embedding classification + Affectively's behavioral taxonomy
 * + inference for audience-specific emotional prediction.
 */

// ── Types ───────────────────────────────────────────────────────────

/** The emotional impact prediction for a block */
export interface EmotionalImpact {
  /** Block ID */
  readonly alienationRisk: AlienationRisk | null;
  /** Primary emotion evoked */
  readonly arousal: number;
  /** Secondary emotions */
  readonly audienceReactions: AudienceReaction[];
  /** Emotional intensity (0-1) */
  readonly blockId: string;
  /** Valence: positive ↔ negative (-1 to 1) */
  readonly dominance: number;
  /** Arousal: calming ↔ activating (0 to 1) */
  readonly empathy: number;
  /** Dominance: submissive ↔ dominant (0 to 1) */
  readonly intensity: number;
  /** Per-audience breakdown */
  readonly persuasion: number;
  /** Empathy score: how much will readers relate? (0-1) */
  readonly primaryEmotion: Emotion;
  /** Persuasion effectiveness (0-1) */
  readonly secondaryEmotions: Emotion[];
  /** Whether this block might alienate some readers */
  readonly valence: number;
}

export type Emotion =
  | 'joy'
  | 'sadness'
  | 'anger'
  | 'fear'
  | 'surprise'
  | 'disgust'
  | 'trust'
  | 'anticipation'
  | 'curiosity'
  | 'confusion'
  | 'awe'
  | 'gratitude'
  | 'hope'
  | 'pride'
  | 'guilt'
  | 'shame'
  | 'nostalgia'
  | 'empowerment'
  | 'vulnerability'
  | 'neutral';

export interface AudienceReaction {
  /** Audience segment */
  readonly audience: string;
  /** How this segment would react */
  readonly intensity: number;
  /** Intensity of the reaction (0-1) */
  readonly reaction: Emotion;
  /** Brief explanation */
  readonly reason: string;
}

export interface AlienationRisk {
  /** Who might be alienated */
  readonly audience: string;
  /** Why */
  readonly mitigation: string;
  /** How severe (0-1) */
  readonly reason: string;
  /** Suggested mitigation */
  readonly severity: number;
}

/** Document-level emotional arc */
export interface EmotionalArc {
  /** Per-block emotional data */
  readonly arcType: ArcType;
  /** Arc shape classification */
  readonly points: Array<{
    arousal: number;
    blockId: string; // 0-1 through the document
    emotion: Emotion;
    position: number;
    valence: number;
  }>;
  /** Overall emotional trajectory description */
  readonly trajectory: string;
}

export type ArcType =
  | 'rags-to-riches' // negative → positive
  | 'riches-to-rags' // positive → negative
  | 'icarus' // rise → fall
  | 'cinderella' // rise → fall → rise
  | 'oedipus' // fall → rise → fall
  | 'steady' // flat
  | 'crescendo' // building intensity
  | 'decrescendo'; // fading intensity

export interface ResonanceConfig {
  /** Inference function */
  readonly audiences?: string[];
  /** Target audiences to predict reactions for */
  readonly checkAlienation?: boolean;
  /** Whether to check for alienation risk (default: true) */
  readonly inferFn: (prompt: string) => Promise<string>;
}

// ── Emotional Resonance Engine ──────────────────────────────────────

export class EmotionalResonance {
  private config: Required<ResonanceConfig>;
  private blockImpacts: Map<string, EmotionalImpact> = new Map();
  private arc: EmotionalArc | null = null;
  private listeners: Set<(impacts: Map<string, EmotionalImpact>) => void> =
    new Set();

  constructor(config: ResonanceConfig) {
    this.config = {
      inferFn: config.inferFn,
      audiences: config.audiences ?? [
        'supporters',
        'skeptics',
        'newcomers',
        'experts',
      ],
      checkAlienation: config.checkAlienation ?? true,
    };
  }

  /**
   * Predict how a single block will land emotionally.
   */
  async predictImpact(
    blockId: string,
    text: string,
    context?: {
      precedingText?: string;
      documentTone?: string;
      authorIntent?: string;
    }
  ): Promise<EmotionalImpact> {
    const contextStr = context
      ? `Context — preceding text: "${
          context.precedingText?.slice(0, 200) ?? 'n/a'
        }", document tone: ${
          context.documentTone ?? 'unknown'
        }, author intent: ${context.authorIntent ?? 'unknown'}`
      : '';

    const prompt = `You are an emotional intelligence system. Predict how readers will emotionally react to this text.
    ${contextStr}

    Text: "${text.slice(0, 500)}"

    Audiences to consider: ${this.config.audiences.join(', ')}

    Respond in JSON:
    {
      "primaryEmotion": string (one of: joy, sadness, anger, fear, surprise, trust, curiosity, confusion, awe, hope, empowerment, vulnerability, neutral),
      "secondaryEmotions": string[],
      "intensity": number (0-1),
      "valence": number (-1 to 1, neg=negative, pos=positive),
      "arousal": number (0-1, 0=calming, 1=activating),
      "dominance": number (0-1),
      "audienceReactions": [{ "audience": string, "reaction": string, "intensity": number, "reason": string }],
      "empathy": number (0-1),
      "persuasion": number (0-1),
      "alienationRisk": null | { "audience": string, "reason": string, "severity": number, "mitigation": string }
    }`;

    try {
      const response = await this.config.inferFn(prompt);
      const result = JSON.parse(response);
      const impact: EmotionalImpact = {
        blockId,
        primaryEmotion: result.primaryEmotion ?? 'neutral',
        secondaryEmotions: result.secondaryEmotions ?? [],
        intensity: result.intensity ?? 0.5,
        valence: result.valence ?? 0,
        arousal: result.arousal ?? 0.5,
        dominance: result.dominance ?? 0.5,
        audienceReactions: result.audienceReactions ?? [],
        empathy: result.empathy ?? 0.5,
        persuasion: result.persuasion ?? 0.5,
        alienationRisk: result.alienationRisk ?? null,
      };

      this.blockImpacts.set(blockId, impact);
      this.notify();
      return impact;
    } catch {
      // Fallback: heuristic-based (covers inference rejection + parse errors)
      const fallback = this.heuristicImpact(blockId, text);
      this.blockImpacts.set(blockId, fallback);
      this.notify();
      return fallback;
    }
  }

  /**
   * Analyze the emotional arc of the entire document.
   * Maps the emotional journey a reader takes through the document.
   */
  async analyzeArc(
    blocks: Array<{ id: string; text: string; sentiment?: number }>
  ): Promise<EmotionalArc> {
    // Compute per-block emotional point
    const points: EmotionalArc['points'] = [];

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      let impact = this.blockImpacts.get(block.id);

      if (!impact) {
        // Use sentiment as proxy if available, or compute
        const valence = block.sentiment ?? 0;
        impact = this.heuristicImpact(block.id, block.text);
      }

      points.push({
        blockId: block.id,
        position: blocks.length > 1 ? i / (blocks.length - 1) : 0,
        valence: impact.valence,
        arousal: impact.arousal,
        emotion: impact.primaryEmotion,
      });
    }

    // Classify the arc shape
    const arcType = this.classifyArc(points);

    // Generate trajectory description
    const trajectory = await this.describeTrajectory(points, arcType);

    this.arc = { points, arcType, trajectory };
    return this.arc;
  }

  /**
   * Predict how a specific edit would change the emotional landing.
   */
  async predictEditImpact(
    blockId: string,
    originalText: string,
    editedText: string
  ): Promise<{
    before: EmotionalImpact;
    after: EmotionalImpact;
    change: string;
  }> {
    const [before, after] = await Promise.all([
      this.predictImpact(`${blockId}-before`, originalText),
      this.predictImpact(`${blockId}-after`, editedText),
    ]);

    const valenceShift = after.valence - before.valence;
    const arousalShift = after.arousal - before.arousal;

    let change: string;
    if (Math.abs(valenceShift) < 0.1 && Math.abs(arousalShift) < 0.1) {
      change = 'Minimal emotional change';
    } else if (valenceShift > 0.2) {
      change = `More ${
        after.arousal > 0.6 ? 'exciting' : 'comforting'
      } — readers will feel more positive`;
    } else if (valenceShift < -0.2) {
      change = `More ${
        after.arousal > 0.6 ? 'alarming' : 'somber'
      } — readers will feel more negative`;
    } else if (arousalShift > 0.2) {
      change = 'More intense — higher emotional activation';
    } else {
      change = `Subtle shift: ${before.primaryEmotion} → ${after.primaryEmotion}`;
    }

    return { before, after, change };
  }

  /**
   * Get the emotional impact for a block.
   */
  getImpact(blockId: string): EmotionalImpact | undefined {
    return this.blockImpacts.get(blockId);
  }

  /**
   * Get the emotional arc.
   */
  getArc(): EmotionalArc | null {
    return this.arc;
  }

  /**
   * Get a summary string for a block's emotional impact.
   */
  getSummary(blockId: string): string {
    const impact = this.blockImpacts.get(blockId);
    if (!impact) return '';

    let summary = `${impact.primaryEmotion} (${(impact.intensity * 100).toFixed(
      0
    )}% intensity)`;

    if (impact.alienationRisk) {
      summary += ` ⚠ may alienate ${impact.alienationRisk.audience}`;
    }

    return summary;
  }

  /**
   * Get the emotional color for visualization (valence → hue).
   */
  getEmotionColor(blockId: string): string {
    const impact = this.blockImpacts.get(blockId);
    if (!impact) return 'hsla(0, 0%, 50%, 0.3)';

    // Map valence (-1..1) and arousal to color
    const hue =
      impact.valence > 0
        ? 40 + impact.valence * 80 // amber → green
        : 240 + impact.valence * 40; // blue → purple
    const saturation = 30 + impact.intensity * 50;
    const lightness = 40 + (1 - impact.arousal) * 20;

    return `hsla(${hue}, ${saturation}%, ${lightness}%, 0.4)`;
  }

  /**
   * Listen for impact changes.
   */
  onChange(
    listener: (impacts: Map<string, EmotionalImpact>) => void
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── Private ───────────────────────────────────────────────────

  private heuristicImpact(blockId: string, text: string): EmotionalImpact {
    const words = text.toLowerCase().split(/\s+/);
    const hasQuestion = text.includes('?');
    const hasExclamation = text.includes('!');
    const length = words.length;

    // Very rough heuristic mapping
    const positiveWords = new Set([
      'good',
      'great',
      'love',
      'happy',
      'beautiful',
      'amazing',
      'wonderful',
      'excellent',
      'best',
      'hope',
      'joy',
      'succeed',
    ]);
    const negativeWords = new Set([
      'bad',
      'terrible',
      'hate',
      'sad',
      'ugly',
      'awful',
      'worst',
      'fail',
      'fear',
      'anger',
      'pain',
      'problem',
    ]);

    let posCount = 0,
      negCount = 0;
    for (const w of words) {
      if (positiveWords.has(w)) posCount++;
      if (negativeWords.has(w)) negCount++;
    }

    const valence =
      length > 0 ? (posCount - negCount) / Math.max(1, posCount + negCount) : 0;
    const arousal = hasExclamation ? 0.7 : hasQuestion ? 0.5 : 0.3;

    const emotion: Emotion =
      valence > 0.2
        ? 'joy'
        : valence < -0.2
        ? 'sadness'
        : hasQuestion
        ? 'curiosity'
        : 'neutral';

    return {
      blockId,
      primaryEmotion: emotion,
      secondaryEmotions: [],
      intensity: Math.min(
        1,
        ((posCount + negCount) / Math.max(1, length)) * 10
      ),
      valence,
      arousal,
      dominance: 0.5,
      audienceReactions: [],
      empathy: 0.5,
      persuasion: 0.5,
      alienationRisk: null,
    };
  }

  private classifyArc(points: EmotionalArc['points']): ArcType {
    if (points.length < 3) return 'steady';

    const firstThird = points.slice(0, Math.ceil(points.length / 3));
    const middleThird = points.slice(
      Math.ceil(points.length / 3),
      Math.ceil((points.length * 2) / 3)
    );
    const lastThird = points.slice(Math.ceil((points.length * 2) / 3));

    const avgFirst =
      firstThird.reduce((s, p) => s + p.valence, 0) / firstThird.length;
    const avgMiddle =
      middleThird.reduce((s, p) => s + p.valence, 0) / middleThird.length;
    const avgLast =
      lastThird.reduce((s, p) => s + p.valence, 0) / lastThird.length;

    const rising = avgLast > avgFirst + 0.2;
    const falling = avgLast < avgFirst - 0.2;
    const middlePeak =
      avgMiddle > avgFirst + 0.15 && avgMiddle > avgLast + 0.15;
    const middleTrough =
      avgMiddle < avgFirst - 0.15 && avgMiddle < avgLast - 0.15;

    if (rising && !middleTrough) return 'rags-to-riches';
    if (falling && !middlePeak) return 'riches-to-rags';
    if (middlePeak && falling) return 'icarus';
    if (middleTrough && rising) return 'cinderella';
    if (middlePeak && !falling) return 'oedipus';

    // Check arousal for crescendo/decrescendo
    const avgArousalFirst =
      firstThird.reduce((s, p) => s + p.arousal, 0) / firstThird.length;
    const avgArousalLast =
      lastThird.reduce((s, p) => s + p.arousal, 0) / lastThird.length;

    if (avgArousalLast > avgArousalFirst + 0.2) return 'crescendo';
    if (avgArousalLast < avgArousalFirst - 0.2) return 'decrescendo';

    return 'steady';
  }

  private async describeTrajectory(
    points: EmotionalArc['points'],
    arcType: ArcType
  ): Promise<string> {
    const arcDescriptions: Record<ArcType, string> = {
      'rags-to-riches':
        'The document builds from tension to resolution — readers will finish feeling uplifted.',
      'riches-to-rags':
        'The document starts strong but ends on a sober note — readers may feel deflated.',
      icarus:
        'The emotional peak comes mid-document; the ending may feel anticlimactic.',
      cinderella:
        'Classic story arc: tension → crisis → resolution. Emotionally satisfying.',
      oedipus:
        'Unsettling arc: starts well, dips, then rises again. Readers may feel whiplashed.',
      steady:
        'Emotionally consistent throughout. Stable, but may lack dynamic engagement.',
      crescendo:
        'Builds intensity toward the end — readers will feel the crescendo.',
      decrescendo:
        'Opens with high energy and winds down. Good for calming; risky if the ending matters.',
    };

    return arcDescriptions[arcType] ?? 'Unique emotional trajectory.';
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.blockImpacts);
    }
  }
}
