/**
 * ContentKnapsack — Let the piece organize itself to the container
 *
 * THE KNAPSACK FOR INFORMATION.
 *
 * The viewport is a container with finite capacity.
 * Each block has a VALUE (emotional intensity × contextual relevance ×
 * freshness) and a WEIGHT (pixels, reading time, cognitive load).
 *
 * The layout engine solves: maximize information value given available space.
 *
 * What this means:
 *   - Stale blocks COMPRESS (low value/weight → collapse to summary)
 *   - High-resonance blocks EXPAND (readers care → more real estate)
 *   - Fresh, dense, relevant content wins prime positioning
 *   - Same document renders differently on mobile vs desktop
 *     (not just reflow — different information priority)
 *   - Reading behavior feeds back into value (highlight → value ↑, skip → value ↓)
 *   - As the reader scrolls, the knapsack re-solves for current viewport
 *
 * ESI PERSONALIZATION:
 *   - Value signals can be overridden per-reader via ESI tags
 *   - <esi:include src="/knapsack/values?reader={did}&block={id}" />
 *   - The edge resolves personalized values before the knapsack solves
 *   - Same document, different layout per reader. Information economics.
 *
 * This is NOT responsive design. This is INFORMATION ECONOMICS.
 */

// ── Types ───────────────────────────────────────────────────────────

export interface ContentItem {
  /** Block ID */
  readonly blockId: string;
  /** Full content text */
  readonly fullText: string;
  /** Compressed summary (for collapsed rendering) */
  readonly summary: string;
  /** Block type */
  readonly blockType:
    | 'heading'
    | 'paragraph'
    | 'code'
    | 'image'
    | 'list'
    | 'blockquote'
    | 'table';
  /** Whether this block is structurally required (headings, etc.) */
  readonly structural: boolean;
}

export interface ContentValue {
  /** Block ID */
  readonly blockId: string;
  /** Emotional intensity (from Amygdala) */
  readonly emotionalIntensity: number;
  /** Contextual relevance to viewport focus (from Hippocampus) */
  readonly contextualRelevance: number;
  /** Content freshness (from DocumentMetabolism) */
  readonly freshness: number;
  /** Reader engagement signal (from ReaderWriterSymbiosis) */
  readonly readerEngagement: number;
  /** Computed composite value */
  readonly compositeValue: number;
}

export interface ContentWeight {
  /** Block ID */
  readonly blockId: string;
  /** Full render height in pixels */
  readonly fullHeightPx: number;
  /** Compressed render height in pixels */
  readonly compressedHeightPx: number;
  /** Estimated reading time in seconds */
  readonly readingTimeSec: number;
  /** Cognitive load (0-1, from complexity/density) */
  readonly cognitiveLoad: number;
  /** Computed composite weight (in container units) */
  readonly compositeWeight: number;
  /** Minimum weight (even when maximally compressed) */
  readonly minWeight: number;
}

export interface LayoutDecision {
  /** Block ID */
  readonly blockId: string;
  /** Rendering mode for this block */
  readonly renderMode: RenderMode;
  /** Allocated height in pixels */
  readonly allocatedHeight: number;
  /** Position (0-based ordering) */
  readonly position: number;
  /** Value-to-weight ratio (higher = better real estate utilization) */
  readonly efficiency: number;
  /** Whether this block was included in the knapsack solution */
  readonly included: boolean;
}

export type RenderMode =
  | 'full' // show everything — this block earned its space
  | 'comfortable' // full content, generous spacing
  | 'compact' // full content, tighter spacing
  | 'compressed' // show summary, expandable
  | 'collapsed' // single-line indicator, expandable
  | 'hidden'; // not rendered (below viewport, or zero value)

export interface ContainerConstraints {
  /** Available height in pixels */
  readonly heightPx: number;
  /** Available width in pixels */
  readonly widthPx: number;
  /** Maximum cognitive load budget (0-1) per viewport */
  readonly maxCognitiveLoad?: number;
  /** Minimum number of blocks to always show */
  readonly minBlocks?: number;
  /** Whether structural blocks (headings) must always be included */
  readonly preserveStructure?: boolean;
}

export interface KnapsackConfig {
  /** Value calculation weights */
  readonly valueWeights?: {
    emotion: number;
    relevance: number;
    freshness: number;
    engagement: number;
  };
  /** Compression thresholds */
  readonly compressionThresholds?: {
    /** Below this value ratio, compress */
    compressBelow: number;
    /** Below this value ratio, collapse */
    collapseBelow: number;
    /** Below this value ratio, hide */
    hideBelow: number;
  };
  /** Animate transitions between layout states */
  readonly animateTransitions?: boolean;
  /** Transition duration in ms */
  readonly transitionMs?: number;
  /** ESI configuration for personalization */
  readonly esi?: ESIKnapsackConfig;
}

// ── ESI Personalization ─────────────────────────────────────────────

/**
 * ESI-aware knapsack configuration.
 * When ESI is enabled, the knapsack renders ESI include tags
 * that the edge resolves per-reader before layout is computed client-side.
 */
export interface ESIKnapsackConfig {
  /** Whether ESI personalization is enabled */
  readonly enabled: boolean;
  /** Base URL for ESI value resolution */
  readonly baseUrl: string;
  /** Cache TTL for personalized values (seconds) */
  readonly cacheTTL?: number;
  /** Fallback to unpersonalized values when ESI fails */
  readonly fallbackToDefault?: boolean;
}

/**
 * Per-reader personalization context, resolved at the edge.
 * This is what makes the same document layout differently for each reader.
 */
export interface PersonalizationContext {
  /** Reader DID (for UCAN-scoped personalization) */
  readonly readerDid: string;
  /** Reader's engagement history with this document */
  readonly engagementHistory?: ReaderHistory;
  /** Reader's declared interests/preferences */
  readonly preferences?: ReaderPreferences;
  /** Reader's reading level (affects cognitive load budget) */
  readonly readingLevel?: 'casual' | 'standard' | 'expert';
  /** Reader's device class (affects container capacity) */
  readonly deviceClass?: 'phone' | 'tablet' | 'desktop' | 'tv';
}

export interface ReaderHistory {
  /** Blocks previously read (for de-prioritizing seen content) */
  readonly blocksRead: string[];
  /** Blocks previously highlighted */
  readonly blocksHighlighted: string[];
  /** Time spent per block in previous sessions */
  readonly timePerBlock: Record<string, number>;
  /** Last read position */
  readonly lastPosition?: string;
  /** Number of visits */
  readonly visitCount: number;
}

export interface ReaderPreferences {
  /** Preferred topics (boost value of matching blocks) */
  readonly topics: string[];
  /** Content density preference */
  readonly density: 'sparse' | 'normal' | 'dense';
  /** Whether to show code blocks (non-technical readers hide code) */
  readonly showCode: boolean;
  /** Whether to expand examples */
  readonly showExamples: boolean;
  /** Preferred emotional tone (boost/demote blocks by tone) */
  readonly tonePref?: 'formal' | 'casual' | 'neutral';
}

/**
 * ESI-resolved per-block value override.
 * The edge returns this for each block, personalized per reader.
 */
export interface ESIValueOverride {
  readonly blockId: string;
  /** Override emotional intensity based on reader's emotional profile */
  readonly emotionalIntensity?: number;
  /** Override relevance based on reader's interests */
  readonly contextualRelevance?: number;
  /** Override freshness based on reader's last visit */
  readonly freshness?: number;
  /** Override engagement based on reader's history with this content */
  readonly readerEngagement?: number;
  /** Boost factor (multiplicative, 1.0 = no change) */
  readonly boostFactor?: number;
  /** Force a render mode regardless of knapsack solution */
  readonly forceRenderMode?: RenderMode;
}

export interface LayoutResult {
  /** Ordered layout decisions for each block */
  readonly decisions: LayoutDecision[];
  /** Total value packed into the container */
  readonly totalValue: number;
  /** Container utilization (0-1) */
  readonly utilization: number;
  /** Total cognitive load in viewport */
  readonly cognitiveLoad: number;
  /** Blocks that didn't fit */
  readonly overflow: string[];
  /** Solution metadata */
  readonly meta: {
    solveTimeMs: number;
    algorithm: 'dp' | 'greedy' | 'fractional';
    containerCapacity: number;
    itemCount: number;
  };
  /** Whether this layout was personalized via ESI */
  readonly personalized: boolean;
  /** Reader DID if personalized */
  readonly readerDid?: string;
}

// ── Content Knapsack Engine ─────────────────────────────────────────

export class ContentKnapsack {
  private config: Required<Omit<KnapsackConfig, 'esi'>> & {
    esi?: ESIKnapsackConfig;
  };
  private items: Map<string, ContentItem> = new Map();
  private values: Map<string, ContentValue> = new Map();
  private weights: Map<string, ContentWeight> = new Map();
  private esiOverrides: Map<string, ESIValueOverride> = new Map();
  private lastResult: LayoutResult | null = null;
  private listeners: Set<(result: LayoutResult) => void> = new Set();

  constructor(config?: KnapsackConfig) {
    this.config = {
      valueWeights: config?.valueWeights ?? {
        emotion: 0.25,
        relevance: 0.35,
        freshness: 0.2,
        engagement: 0.2,
      },
      compressionThresholds: config?.compressionThresholds ?? {
        compressBelow: 0.4,
        collapseBelow: 0.2,
        hideBelow: 0.05,
      },
      animateTransitions: config?.animateTransitions ?? true,
      transitionMs: config?.transitionMs ?? 300,
      esi: config?.esi,
    };
  }

  // ── Registration ──────────────────────────────────────────────

  /**
   * Register a content item with its value and weight signals.
   */
  registerItem(
    item: ContentItem,
    value: Omit<ContentValue, 'compositeValue'>,
    weight: Omit<ContentWeight, 'compositeWeight' | 'minWeight'>
  ): void {
    this.items.set(item.blockId, item);

    // Compute composite value
    const w = this.config.valueWeights;
    const compositeValue =
      value.emotionalIntensity * w.emotion +
      value.contextualRelevance * w.relevance +
      value.freshness * w.freshness +
      value.readerEngagement * w.engagement;

    this.values.set(item.blockId, { ...value, compositeValue });

    // Compute composite weight (normalize to container-relative units)
    const compositeWeight = weight.fullHeightPx;
    const minWeight = weight.compressedHeightPx * 0.3; // even collapsed takes some space

    this.weights.set(item.blockId, { ...weight, compositeWeight, minWeight });
  }

  /**
   * Update value signals for a block (e.g., reader engagement changed).
   */
  updateValue(
    blockId: string,
    partial: Partial<Omit<ContentValue, 'compositeValue' | 'blockId'>>
  ): void {
    const existing = this.values.get(blockId);
    if (!existing) return;

    const updated = { ...existing, ...partial };
    const w = this.config.valueWeights;
    const compositeValue =
      updated.emotionalIntensity * w.emotion +
      updated.contextualRelevance * w.relevance +
      updated.freshness * w.freshness +
      updated.readerEngagement * w.engagement;

    this.values.set(blockId, { ...updated, compositeValue });
  }

  // ── Solve ─────────────────────────────────────────────────────

  /**
   * Solve the knapsack: given container constraints, determine rendering.
   */
  solve(constraints: ContainerConstraints): LayoutResult {
    const start = performance.now();

    const blockIds = Array.from(this.items.keys());
    const capacity = constraints.heightPx;

    // Separate structural (always included) from optional
    const structural: string[] = [];
    const optional: string[] = [];

    for (const id of blockIds) {
      const item = this.items.get(id)!;
      if (constraints.preserveStructure !== false && item.structural) {
        structural.push(id);
      } else {
        optional.push(id);
      }
    }

    // Reserve space for structural blocks
    let reservedHeight = 0;
    for (const id of structural) {
      const weight = this.weights.get(id);
      if (weight) {
        reservedHeight += weight.compressedHeightPx; // structural gets at least compressed size
      }
    }

    const availableForOptional = Math.max(0, capacity - reservedHeight);

    // Solve 0/1 knapsack for optional blocks
    // Use fractional approach for smooth rendering (blocks can be partially compressed)
    const solution =
      optional.length > 100
        ? this.greedySolve(optional, availableForOptional)
        : this.fractionalSolve(optional, availableForOptional);

    // Build layout decisions
    const decisions: LayoutDecision[] = [];
    let totalValue = 0;
    let totalHeight = 0;
    let totalCognitiveLoad = 0;
    const overflow: string[] = [];
    let position = 0;

    // Add structural blocks first
    for (const id of structural) {
      const value = this.values.get(id);
      const weight = this.weights.get(id);
      if (!value || !weight) continue;

      const allocatedHeight = this.determineHeight(
        id,
        value.compositeValue,
        weight,
        capacity
      );
      const renderMode = this.determineRenderMode(
        value.compositeValue,
        allocatedHeight,
        weight
      );

      decisions.push({
        blockId: id,
        renderMode,
        allocatedHeight,
        position: position++,
        efficiency: value.compositeValue / Math.max(1, allocatedHeight),
        included: true,
      });

      totalValue += value.compositeValue;
      totalHeight += allocatedHeight;
      totalCognitiveLoad +=
        weight.cognitiveLoad * (allocatedHeight / weight.fullHeightPx);
    }

    // Add solved optional blocks
    for (const [id, fraction] of solution) {
      const value = this.values.get(id);
      const weight = this.weights.get(id);
      if (!value || !weight) continue;

      if (fraction <= 0) {
        overflow.push(id);
        decisions.push({
          blockId: id,
          renderMode: 'hidden',
          allocatedHeight: 0,
          position: position++,
          efficiency: 0,
          included: false,
        });
        continue;
      }

      const allocatedHeight =
        weight.compressedHeightPx +
        (weight.fullHeightPx - weight.compressedHeightPx) * fraction;
      const renderMode = this.fractionToRenderMode(fraction);

      decisions.push({
        blockId: id,
        renderMode,
        allocatedHeight: Math.round(allocatedHeight),
        position: position++,
        efficiency:
          (value.compositeValue * fraction) / Math.max(1, allocatedHeight),
        included: true,
      });

      totalValue += value.compositeValue * fraction;
      totalHeight += allocatedHeight;
      totalCognitiveLoad += weight.cognitiveLoad * fraction;
    }

    // Enforce minimum blocks
    if (
      constraints.minBlocks &&
      decisions.filter((d) => d.included).length < constraints.minBlocks
    ) {
      // Promote hidden blocks with highest value until minBlocks met
      const hidden = decisions
        .filter((d) => !d.included)
        .sort((a, b) => {
          const va = this.values.get(a.blockId)?.compositeValue ?? 0;
          const vb = this.values.get(b.blockId)?.compositeValue ?? 0;
          return vb - va;
        });

      let included = decisions.filter((d) => d.included).length;
      for (const decision of hidden) {
        if (included >= constraints.minBlocks) break;
        (decision as { renderMode: RenderMode }).renderMode = 'collapsed';
        (decision as { included: boolean }).included = true;
        (decision as { allocatedHeight: number }).allocatedHeight =
          this.weights.get(decision.blockId)?.minWeight ?? 24;
        included++;
      }
    }

    // Enforce cognitive load budget
    if (
      constraints.maxCognitiveLoad &&
      totalCognitiveLoad > constraints.maxCognitiveLoad
    ) {
      // Compress the least-valuable blocks until under budget
      const byValue = [...decisions]
        .filter((d) => d.included && !this.items.get(d.blockId)?.structural)
        .sort((a, b) => {
          const va = this.values.get(a.blockId)?.compositeValue ?? 0;
          const vb = this.values.get(b.blockId)?.compositeValue ?? 0;
          return va - vb; // lowest value first
        });

      for (const decision of byValue) {
        if (totalCognitiveLoad <= (constraints.maxCognitiveLoad ?? 1)) break;
        const weight = this.weights.get(decision.blockId);
        if (!weight) continue;

        const savings = weight.cognitiveLoad * 0.5;
        totalCognitiveLoad -= savings;
        (decision as { renderMode: RenderMode }).renderMode = 'compressed';
      }
    }

    const elapsed = performance.now() - start;

    const result: LayoutResult = {
      decisions: decisions.sort((a, b) => a.position - b.position),
      totalValue,
      utilization: totalHeight / Math.max(1, capacity),
      cognitiveLoad: totalCognitiveLoad,
      overflow,
      personalized: false,
      meta: {
        solveTimeMs: elapsed,
        algorithm: optional.length > 100 ? 'greedy' : 'fractional',
        containerCapacity: capacity,
        itemCount: blockIds.length,
      },
    };

    this.lastResult = result;
    this.notify(result);
    return result;
  }

  /**
   * Re-solve for current constraints (for viewport changes, scroll, etc.)
   */
  getLastResult(): LayoutResult | null {
    return this.lastResult;
  }

  /**
   * Listen for layout changes.
   */
  onChange(listener: (result: LayoutResult) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── ESI Personalization ──────────────────────────────────────

  /**
   * Apply per-reader ESI value overrides.
   * These are resolved at the edge before the client-side knapsack runs.
   */
  applyESIOverrides(overrides: ESIValueOverride[]): void {
    for (const override of overrides) {
      this.esiOverrides.set(override.blockId, override);

      // Apply overrides to the value signals
      const existing = this.values.get(override.blockId);
      if (existing) {
        this.updateValue(override.blockId, {
          emotionalIntensity:
            override.emotionalIntensity ?? existing.emotionalIntensity,
          contextualRelevance:
            override.contextualRelevance ?? existing.contextualRelevance,
          freshness: override.freshness ?? existing.freshness,
          readerEngagement:
            override.readerEngagement ?? existing.readerEngagement,
        });

        // Apply boost factor
        if (override.boostFactor && override.boostFactor !== 1.0) {
          const boosted = this.values.get(override.blockId)!;
          const boostedComposite =
            boosted.compositeValue * override.boostFactor;
          this.values.set(override.blockId, {
            ...boosted,
            compositeValue: boostedComposite,
          } as ContentValue);
        }
      }
    }
  }

  /**
   * Personalize the knapsack for a specific reader.
   * This adjusts values based on the reader's context and then solves.
   */
  personalizedSolve(
    constraints: ContainerConstraints,
    context: PersonalizationContext
  ): LayoutResult {
    // Adjust container capacity based on device class
    const adjustedConstraints = this.adjustForDevice(constraints, context);

    // Adjust cognitive load budget based on reading level
    const cognitiveConstraints = this.adjustCognitiveLoad(
      adjustedConstraints,
      context
    );

    // Apply preference-based value adjustments
    this.applyPreferenceBoosts(context);

    // Apply history-based adjustments (de-prioritize already-read content)
    this.applyHistoryAdjustments(context);

    // Solve with personalized values
    const result = this.solve(cognitiveConstraints);

    // Apply forced render modes from ESI overrides
    for (const decision of result.decisions) {
      const override = this.esiOverrides.get(decision.blockId);
      if (override?.forceRenderMode) {
        (decision as { renderMode: RenderMode }).renderMode =
          override.forceRenderMode;
      }
    }

    // Tag the result as personalized
    return {
      ...result,
      personalized: true,
      readerDid: context.readerDid,
    };
  }

  /**
   * Generate ESI include tags for server-side resolution.
   * These are embedded in the document HTML for edge processing.
   */
  generateESITags(documentId: string): string[] {
    if (!this.config.esi?.enabled) return [];

    const baseUrl = this.config.esi.baseUrl;
    const ttl = this.config.esi.cacheTTL ?? 300;
    const tags: string[] = [];

    // Per-block value resolution
    for (const blockId of this.items.keys()) {
      tags.push(
        `<esi:include src="${baseUrl}/knapsack/values?block=${blockId}&doc=${documentId}" ` +
          `ttl="${ttl}" ` +
          `onerror="continue" />`
      );
    }

    // Reader context resolution
    tags.push(
      `<esi:include src="${baseUrl}/knapsack/context?doc=${documentId}" ` +
        `ttl="${ttl}" ` +
        `onerror="continue" />`
    );

    return tags;
  }

  /**
   * Generate a serializable layout manifest for SSR.
   * The edge can pre-compute this and embed it in the HTML.
   */
  generateLayoutManifest(documentId: string): LayoutManifest {
    const result = this.lastResult;
    return {
      documentId,
      timestamp: Date.now(),
      decisions: result?.decisions ?? [],
      esiEnabled: this.config.esi?.enabled ?? false,
      esiTags: this.generateESITags(documentId),
    };
  }

  // ── ESI Private Helpers ──────────────────────────────────────

  private adjustForDevice(
    constraints: ContainerConstraints,
    context: PersonalizationContext
  ): ContainerConstraints {
    // Mobile gets tighter capacity → more aggressive compression
    const deviceMultiplier = {
      phone: 0.4,
      tablet: 0.7,
      desktop: 1.0,
      tv: 1.5,
    };

    const mult = context.deviceClass
      ? deviceMultiplier[context.deviceClass]
      : 1.0;

    return {
      ...constraints,
      heightPx: Math.round(constraints.heightPx * mult),
    };
  }

  private adjustCognitiveLoad(
    constraints: ContainerConstraints,
    context: PersonalizationContext
  ): ContainerConstraints {
    const loadBudget = {
      casual: 0.4,
      standard: 0.7,
      expert: 1.0,
    };

    const budget = context.readingLevel
      ? loadBudget[context.readingLevel]
      : constraints.maxCognitiveLoad;

    return {
      ...constraints,
      maxCognitiveLoad: budget,
    };
  }

  private applyPreferenceBoosts(context: PersonalizationContext): void {
    if (!context.preferences) return;

    for (const [blockId, item] of this.items) {
      const value = this.values.get(blockId);
      if (!value) continue;

      let boost = 1.0;

      // Hide code for non-technical readers
      if (!context.preferences.showCode && item.blockType === 'code') {
        boost = 0.05; // nearly hidden
      }

      // Density preference adjusts compression thresholds
      if (context.preferences.density === 'sparse') {
        boost *= 0.8; // everything gets less space
      } else if (context.preferences.density === 'dense') {
        boost *= 1.2; // everything gets more space
      }

      if (boost !== 1.0) {
        this.values.set(blockId, {
          ...value,
          compositeValue: value.compositeValue * boost,
        } as ContentValue);
      }
    }
  }

  private applyHistoryAdjustments(context: PersonalizationContext): void {
    if (!context.engagementHistory) return;

    const history = context.engagementHistory;

    for (const blockId of this.items.keys()) {
      const value = this.values.get(blockId);
      if (!value) continue;

      let modifier = 1.0;

      // De-prioritize already-read blocks on repeat visits
      if (history.blocksRead.includes(blockId) && history.visitCount > 1) {
        modifier *= 0.6; // returning readers see less-read content promoted
      }

      // Boost blocks they previously highlighted (they care about these)
      if (history.blocksHighlighted.includes(blockId)) {
        modifier *= 1.5;
      }

      // Boost content after their last read position (continue where they left off)
      // This is handled by tracking position rather than modifying values

      if (modifier !== 1.0) {
        this.values.set(blockId, {
          ...value,
          compositeValue: value.compositeValue * modifier,
        } as ContentValue);
      }
    }
  }

  // ── Solvers ───────────────────────────────────────────────────

  /**
   * Fractional knapsack: items can be partially included.
   * Perfect for content that can render at different compression levels.
   */
  private fractionalSolve(
    blockIds: string[],
    capacity: number
  ): Map<string, number> {
    // Compute value-to-weight ratio for ranking
    const ranked = blockIds
      .map((id) => {
        const value = this.values.get(id)?.compositeValue ?? 0;
        const weight = this.weights.get(id)?.fullHeightPx ?? 1;
        return { id, value, weight, ratio: value / Math.max(1, weight) };
      })
      .sort((a, b) => b.ratio - a.ratio);

    // Deceptacon: floor-weight elimination -- skip blocks whose value/weight
    // ratio falls below the Buleyean floor.  w = R - min(v, R) + 1 where R
    // is the top ratio and v is rejection count (rank position).
    if (ranked.length > 1) {
      const R = ranked.length;
      const topRatio = ranked[0]?.ratio ?? 0;
      const filtered = ranked.filter((_item, idx) => {
        const buleyeanWeight = R - Math.min(idx, R) + 1;
        return buleyeanWeight >= 2 || _item.ratio >= topRatio * 0.05;
      });
      ranked.length = 0;
      ranked.push(...filtered);
    }

    const result = new Map<string, number>();
    let remaining = capacity;

    for (const { id, weight } of ranked) {
      if (remaining <= 0) {
        result.set(id, 0);
        continue;
      }

      if (weight <= remaining) {
        result.set(id, 1); // fully included
        remaining -= weight;
      } else {
        // Fractional inclusion
        const fraction = remaining / weight;
        result.set(id, fraction);
        remaining = 0;
      }
    }

    return result;
  }

  /**
   * Greedy solver for large block counts (O(n log n)).
   */
  private greedySolve(
    blockIds: string[],
    capacity: number
  ): Map<string, number> {
    // Same as fractional for greedy — fractional is already O(n log n)
    return this.fractionalSolve(blockIds, capacity);
  }

  // ── Helpers ───────────────────────────────────────────────────

  private determineHeight(
    _blockId: string,
    value: number,
    weight: ContentWeight,
    _capacity: number
  ): number {
    if (value > 0.8) return weight.fullHeightPx * 1.1; // generous spacing for premium content
    if (value > 0.5) return weight.fullHeightPx;
    if (value > 0.3) return weight.compressedHeightPx;
    return weight.minWeight;
  }

  private determineRenderMode(
    value: number,
    allocatedHeight: number,
    weight: ContentWeight
  ): RenderMode {
    const ratio = allocatedHeight / weight.fullHeightPx;

    if (value > 0.8 && ratio >= 1) return 'comfortable';
    if (ratio >= 0.9) return 'full';
    if (ratio >= 0.6) return 'compact';
    if (ratio >= 0.3) return 'compressed';
    if (ratio > 0) return 'collapsed';
    return 'hidden';
  }

  private fractionToRenderMode(fraction: number): RenderMode {
    if (fraction >= 0.95) return 'comfortable';
    if (fraction >= 0.8) return 'full';
    if (fraction >= 0.5) return 'compact';
    if (fraction >= 0.2) return 'compressed';
    if (fraction > 0) return 'collapsed';
    return 'hidden';
  }

  private notify(result: LayoutResult): void {
    for (const listener of this.listeners) listener(result);
  }
}

// ── Layout Manifest (for SSR/ESI) ───────────────────────────────────

export interface LayoutManifest {
  readonly documentId: string;
  readonly timestamp: number;
  readonly decisions: LayoutDecision[];
  readonly esiEnabled: boolean;
  readonly esiTags: string[];
}
