/**
 * DocumentMetabolism — Information has a half-life
 *
 * NOBODY HAS BUILT THIS.
 *
 * Documents don't age. A technical doc from 2 years ago sits
 * next to a doc from yesterday with equal weight. But information
 * DECAYS. Facts become stale. APIs get deprecated. Advice expires.
 *
 * Meanwhile, some content APPRECIATES. Founding principles get more
 * relevant over time. Design philosophy ages like wine.
 *
 * Documents should have a metabolism:
 *   - Freshness score per block (how likely is this still true?)
 *   - Staleness detection (this references a deprecated API)
 *   - Evergreen classification (this will always be relevant)
 *   - Decay curves (when will this information expire?)
 *   - Cross-reference health (the links/citations still valid?)
 *   - Suggested refresh actions (what needs updating?)
 */

// ── Types ───────────────────────────────────────────────────────────

export type ContentLifespan =
  | 'ephemeral' // hours-days (news, announcements)
  | 'transient' // weeks-months (tutorials, how-tos)
  | 'durable' // months-years (architecture, design docs)
  | 'evergreen' // indefinite (principles, philosophy, fiction)
  | 'unknown';

export interface BlockFreshness {
  /** Block ID */
  readonly blockId: string;
  /** Freshness score (0-1, 1 = fresh) */
  readonly freshness: number;
  /** When this block was last meaningfully edited */
  readonly lastEdited: string;
  /** Predicted lifespan classification */
  readonly lifespan: ContentLifespan;
  /** Predicted expiry date (null for evergreen) */
  readonly predictedExpiry: string | null;
  /** Days until staleness (-∞ for already stale) */
  readonly daysUntilStale: number;
  /** Staleness indicators found */
  readonly indicators: StalenessIndicator[];
  /** Whether this block needs refresh */
  readonly needsRefresh: boolean;
  /** Suggested action if stale */
  readonly refreshAction?: string;
}

export interface StalenessIndicator {
  /** What type of staleness */
  readonly type:
    | 'version-reference'
    | 'date-reference'
    | 'api-reference'
    | 'link-broken'
    | 'fact-check'
    | 'opinion-dated';
  /** The specific text that triggered this */
  readonly trigger: string;
  /** Explanation */
  readonly reason: string;
  /** Severity (0-1) */
  readonly severity: number;
}

export interface DocumentHealth {
  /** Overall freshness of the document (0-1) */
  readonly overallFreshness: number;
  /** Number of blocks needing refresh */
  readonly staleBlocks: number;
  /** Number of evergreen blocks */
  readonly evergreenBlocks: number;
  /** Total blocks analyzed */
  readonly totalBlocks: number;
  /** Estimated document half-life (days) */
  readonly halfLife: number;
  /** When the document will be 50% stale */
  readonly halfLifeDate: string;
  /** Refresh priority list */
  readonly refreshQueue: Array<{
    blockId: string;
    priority: number;
    reason: string;
  }>;
}

export interface MetabolismConfig {
  /** Inference function for fact-checking and lifespan prediction */
  readonly inferFn?: (prompt: string) => Promise<string>;
  /** Custom staleness patterns (regex → indicator type) */
  readonly customPatterns?: Array<{
    pattern: RegExp;
    type: StalenessIndicator['type'];
    reason: string;
  }>;
  /** Default half-life in days for unclassified content */
  readonly defaultHalfLife?: number;
}

// ── Document Metabolism Engine ──────────────────────────────────────

export class DocumentMetabolism {
  private config: MetabolismConfig;
  private blockFreshness: Map<string, BlockFreshness> = new Map();
  private health: DocumentHealth | null = null;
  private listeners: Set<(health: DocumentHealth) => void> = new Set();

  // Built-in staleness patterns
  private static readonly STALENESS_PATTERNS: Array<{
    pattern: RegExp;
    type: StalenessIndicator['type'];
    reasonFn: (match: RegExpMatchArray) => string;
  }> = [
    {
      pattern: /v(\d+\.\d+(?:\.\d+)?)/gi,
      type: 'version-reference',
      reasonFn: (m) =>
        `References version ${m[0]} — check if this is still current`,
    },
    {
      pattern:
        /(?:as of|since|in)\s+(20\d{2}|January|February|March|April|May|June|July|August|September|October|November|December)\b/gi,
      type: 'date-reference',
      reasonFn: (m) => `Time-specific reference: "${m[0]}" — may be outdated`,
    },
    {
      pattern: /(?:currently|right now|at the moment|at present|today)\b/gi,
      type: 'date-reference',
      reasonFn: (m) => `Temporal reference "${m[0]}" becomes stale over time`,
    },
    {
      pattern: /(?:deprecated|legacy|old|outdated|obsolete|replaced by)/gi,
      type: 'api-reference',
      reasonFn: (m) =>
        `Contains "${m[0]}" — likely references something no longer current`,
    },
    {
      pattern: /https?:\/\/[^\s)]+/gi,
      type: 'link-broken',
      reasonFn: () => 'Contains URL — link may break over time',
    },
  ];

  constructor(config?: MetabolismConfig) {
    this.config = config ?? {};
  }

  /**
   * Analyze the metabolism of the entire document.
   */
  async analyze(
    blocks: Array<{
      id: string;
      text: string;
      lastEdited: string;
      blockType: string;
      embedding?: Float32Array;
    }>
  ): Promise<DocumentHealth> {
    const freshnessResults: BlockFreshness[] = [];

    for (const block of blocks) {
      const freshness = await this.analyzeBlock(block);
      freshnessResults.push(freshness);
      this.blockFreshness.set(block.id, freshness);
    }

    // Compute document-level health
    const staleBlocks = freshnessResults.filter((f) => f.needsRefresh).length;
    const evergreenBlocks = freshnessResults.filter(
      (f) => f.lifespan === 'evergreen'
    ).length;
    const overallFreshness =
      freshnessResults.length > 0
        ? freshnessResults.reduce((s, f) => s + f.freshness, 0) /
          freshnessResults.length
        : 1;

    // Estimate document half-life
    const lifespanDays = freshnessResults.map((f) =>
      this.lifespanToDays(f.lifespan)
    );
    const avgLifespan =
      lifespanDays.reduce((s, d) => s + d, 0) /
      Math.max(1, lifespanDays.length);
    const halfLife = avgLifespan;

    const halfLifeDate = new Date(
      Date.now() + halfLife * 24 * 60 * 60 * 1000
    ).toISOString();

    // Build refresh queue
    const refreshQueue = freshnessResults
      .filter((f) => f.needsRefresh)
      .map((f) => ({
        blockId: f.blockId,
        priority: 1 - f.freshness,
        reason:
          f.refreshAction ?? f.indicators[0]?.reason ?? 'Content may be stale',
      }))
      .sort((a, b) => b.priority - a.priority);

    this.health = {
      overallFreshness,
      staleBlocks,
      evergreenBlocks,
      totalBlocks: blocks.length,
      halfLife,
      halfLifeDate,
      refreshQueue,
    };

    this.notify();
    return this.health;
  }

  /**
   * Get freshness for a specific block.
   */
  getBlockFreshness(blockId: string): BlockFreshness | undefined {
    return this.blockFreshness.get(blockId);
  }

  /**
   * Get document health summary.
   */
  getHealth(): DocumentHealth | null {
    return this.health;
  }

  /**
   * Get freshness color for gutter visualization.
   */
  getFreshnessColor(blockId: string): string {
    const freshness = this.blockFreshness.get(blockId);
    if (!freshness) return 'transparent';

    if (freshness.lifespan === 'evergreen') {
      return 'hsla(170, 60%, 45%, 0.4)'; // teal = timeless
    }

    // Green → yellow → red based on freshness
    const hue = freshness.freshness * 120; // 0=red, 120=green
    const alpha = 0.3 + (1 - freshness.freshness) * 0.4;
    return `hsla(${hue}, 70%, 50%, ${alpha})`;
  }

  /**
   * Get a plain-language health summary.
   */
  getSummary(): string {
    if (!this.health) return 'No analysis run yet.';

    const h = this.health;
    if (h.staleBlocks === 0) {
      return `All ${h.totalBlocks} sections are fresh. ${h.evergreenBlocks} are classified as evergreen.`;
    }

    return (
      `${h.staleBlocks} of ${h.totalBlocks} sections need refresh. ` +
      `Document half-life: ~${Math.round(h.halfLife)} days. ` +
      `${h.evergreenBlocks} sections are evergreen.`
    );
  }

  /**
   * Listen for health changes.
   */
  onChange(listener: (health: DocumentHealth) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── Private ───────────────────────────────────────────────────

  private async analyzeBlock(block: {
    id: string;
    text: string;
    lastEdited: string;
    blockType: string;
  }): Promise<BlockFreshness> {
    const daysSinceEdit = this.daysSince(block.lastEdited);
    const indicators = this.findStalenessIndicators(block.text);

    // Classify lifespan
    let lifespan: ContentLifespan = 'unknown';

    if (this.config.inferFn && block.text.length > 20) {
      lifespan = await this.classifyLifespan(block.text, block.blockType);
    } else {
      lifespan = this.heuristicLifespan(
        block.text,
        block.blockType,
        indicators
      );
    }

    // Compute freshness
    const halfLifeDays = this.lifespanToDays(lifespan);
    const decayFactor = Math.exp((-0.693 * daysSinceEdit) / halfLifeDays); // exponential decay
    const indicatorPenalty = indicators.reduce(
      (s, i) => s + i.severity * 0.1,
      0
    );
    const freshness = Math.max(0, Math.min(1, decayFactor - indicatorPenalty));

    const needsRefresh =
      freshness < 0.5 || indicators.some((i) => i.severity > 0.7);

    const predictedExpiry =
      lifespan === 'evergreen'
        ? null
        : new Date(
            new Date(block.lastEdited).getTime() +
              halfLifeDays * 24 * 60 * 60 * 1000
          ).toISOString();

    const daysUntilStale = predictedExpiry
      ? (new Date(predictedExpiry).getTime() - Date.now()) /
        (24 * 60 * 60 * 1000)
      : Infinity;

    let refreshAction: string | undefined;
    if (needsRefresh) {
      if (indicators.length > 0) {
        refreshAction = `Check: ${indicators[0].reason}`;
      } else {
        refreshAction = `Last edited ${daysSinceEdit} days ago — review for accuracy.`;
      }
    }

    return {
      blockId: block.id,
      freshness,
      lastEdited: block.lastEdited,
      lifespan,
      predictedExpiry,
      daysUntilStale,
      indicators,
      needsRefresh,
      refreshAction,
    };
  }

  private findStalenessIndicators(text: string): StalenessIndicator[] {
    const indicators: StalenessIndicator[] = [];
    const allPatterns = [
      ...DocumentMetabolism.STALENESS_PATTERNS,
      ...(this.config.customPatterns?.map((p) => ({
        pattern: p.pattern,
        type: p.type,
        reasonFn: () => p.reason,
      })) ?? []),
    ];

    for (const { pattern, type, reasonFn } of allPatterns) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        indicators.push({
          type,
          trigger: match[0],
          reason: reasonFn(match),
          severity:
            type === 'link-broken'
              ? 0.3
              : type === 'version-reference'
              ? 0.6
              : type === 'date-reference'
              ? 0.5
              : type === 'api-reference'
              ? 0.7
              : 0.4,
        });
      }
    }

    return indicators;
  }

  private heuristicLifespan(
    text: string,
    blockType: string,
    indicators: StalenessIndicator[]
  ): ContentLifespan {
    // Code blocks decay fast
    if (blockType === 'code') return 'transient';

    // Headers and short blocks are often structural (durable)
    if (blockType === 'heading') return 'durable';

    // If it has version refs, it's transient
    if (indicators.some((i) => i.type === 'version-reference'))
      return 'transient';

    // If it has date refs, it's transient
    if (indicators.some((i) => i.type === 'date-reference')) return 'transient';

    // If it has URLs, moderate lifespan
    if (indicators.some((i) => i.type === 'link-broken')) return 'durable';

    // Long prose without temporal indicators → likely durable+
    const words = text.split(/\s+/).length;
    if (words > 50 && indicators.length === 0) return 'evergreen';

    return 'durable';
  }

  private async classifyLifespan(
    text: string,
    blockType: string
  ): Promise<ContentLifespan> {
    if (!this.config.inferFn) return 'unknown';

    const response = await this.config.inferFn(
      `Classify the information half-life of this text. Reply with ONE word:
      ephemeral (hours-days), transient (weeks-months), durable (months-years), or evergreen (indefinite).

      Block type: ${blockType}
      Text: "${text.slice(0, 300)}"`
    );

    const normalized = response.trim().toLowerCase();
    if (
      ['ephemeral', 'transient', 'durable', 'evergreen'].includes(normalized)
    ) {
      return normalized as ContentLifespan;
    }
    return 'unknown';
  }

  private lifespanToDays(lifespan: ContentLifespan): number {
    switch (lifespan) {
      case 'ephemeral':
        return 3;
      case 'transient':
        return 90;
      case 'durable':
        return 365;
      case 'evergreen':
        return 3650; // 10 years
      case 'unknown':
        return this.config.defaultHalfLife ?? 180;
    }
  }

  private daysSince(dateStr: string): number {
    return (Date.now() - new Date(dateStr).getTime()) / (24 * 60 * 60 * 1000);
  }

  private notify(): void {
    if (this.health) {
      for (const listener of this.listeners) listener(this.health);
    }
  }
}
