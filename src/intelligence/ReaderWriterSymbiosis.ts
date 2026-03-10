/**
 * ReaderWriterSymbiosis — Live reader feedback in the writing surface
 *
 * The reader and writer exist in separate universes in every editor.
 * Analytics show you numbers AFTER the fact. What if the editor
 * showed you, WHILE YOU WRITE, that readers stumble here,
 * re-read there, leave at paragraph 7?
 *
 * The writing surface becomes annotated with reader behavior.
 * Not abstractly. Concretely:
 *   - This sentence has a 40% re-read rate (highlight it)
 *   - Readers slow down 3x at this paragraph (it's dense)
 *   - 60% of readers leave at this point (your conclusion doesn't land)
 *   - This metaphor correlates with higher completion rates
 *
 * The reader's experience becomes the writer's instrument.
 */

// ── Types ───────────────────────────────────────────────────────────

export interface ReaderSignal {
  /** Block ID receiving feedback */
  readonly type: ReaderSignalType;
  /** Signal type */
  readonly blockId: string;
  /** Normalized value (0-1, higher = more notable) */
  readonly color: string;
  /** Human-readable label */
  readonly intensity: 'subtle' | 'medium' | 'strong';
  /** Color for gutter annotation */
  readonly label: string;
  /** Decorative intensity for the block */
  readonly suggestion?: string;
  /** Actionable suggestion based on the signal */
  readonly value: number;
}

export type ReaderSignalType =
  | 'slow-read' // readers spend 3x+ expected time
  | 'fast-skip' // readers scroll past quickly
  | 're-read' // readers scroll back to re-read
  | 'drop-off' // readers leave the document here
  | 'highlight' // readers highlight/select this text
  | 'linger' // readers stop scrolling here (engaged)
  | 'share' // readers share from this point
  | 'copy' // readers copy this text
  | 'confusion' // inferred confusion (slow + re-read + leave)
  | 'delight'; // inferred delight (share + highlight + linger)

export interface SymbiosisAnnotation {
  /** Block ID */
  readonly blockId: string;
  /** Combined signals for this block */
  readonly experienceScore: number;
  /** Overall reader experience score (0-1, 1 = best) */
  readonly gutterColor: string;
  /** Whether this block needs attention */
  readonly needsAttention: boolean;
  /** Gutter color (hottest signal) */
  readonly signals: ReaderSignal[];
  /** Tooltip text for hover */
  readonly tooltip: string;
}

export interface SymbiosisConfig {
  /** Minimum reader sessions before signals are meaningful */
  readonly enabledSignals?: ReaderSignalType[];
  /** Whether to show signals in the editor gutter (default: true) */
  readonly minSessions?: number;
  /** Whether to show inline annotations (default: false — opt-in) */
  readonly showGutter?: boolean;
  /** Signal types to display */
  readonly showInline?: boolean;
}

export interface AggregatedReaderData {
  /** Block ID */
  readonly avgTimeMs: number;
  /** Average time spent (ms) */
  readonly blockId: string;
  /** Expected time based on word count (ms) */
  readonly copyRate: number;
  /** Percentage of readers who re-read this block */
  readonly dropOffRate: number;
  /** Percentage of readers who drop off at this block */
  readonly expectedTimeMs: number;
  /** Percentage of readers who highlight/select */
  readonly highlightRate: number;
  /** Percentage of readers who copy text */
  readonly reReadRate: number;
  /** Percentage of readers who share from this point */
  readonly sessions: number;
  /** Total sessions observed */
  readonly shareRate: number;
}

// ── Reader↔Writer Symbiosis Engine ──────────────────────────────────

export class ReaderWriterSymbiosis {
  private config: Required<SymbiosisConfig>;
  private annotations: Map<string, SymbiosisAnnotation> = new Map();
  private listeners: Set<
    (annotations: Map<string, SymbiosisAnnotation>) => void
  > = new Set();

  constructor(config?: SymbiosisConfig) {
    this.config = {
      minSessions: config?.minSessions ?? 10,
      showGutter: config?.showGutter ?? true,
      showInline: config?.showInline ?? false,
      enabledSignals: config?.enabledSignals ?? [
        'slow-read',
        'fast-skip',
        're-read',
        'drop-off',
        'highlight',
        'linger',
        'confusion',
        'delight',
      ],
    };
  }

  /**
   * Ingest aggregated reader data and produce writer-facing signals.
   * This is the bridge: reader behavior → writer annotations.
   */
  processReaderData(
    data: AggregatedReaderData[]
  ): Map<string, SymbiosisAnnotation> {
    this.annotations.clear();

    for (const blockData of data) {
      if (blockData.sessions < this.config.minSessions) continue;

      const signals: ReaderSignal[] = [];
      const timeRatio =
        blockData.avgTimeMs / Math.max(1, blockData.expectedTimeMs);

      // Slow read detection
      if (timeRatio > 3 && this.isEnabled('slow-read')) {
        signals.push({
          blockId: blockData.blockId,
          type: 'slow-read',
          value: Math.min(1, (timeRatio - 3) / 5),
          label: `Readers spend ${timeRatio.toFixed(1)}× expected time here`,
          color: 'hsla(30, 90%, 55%, 0.6)',
          intensity: timeRatio > 5 ? 'strong' : 'medium',
          suggestion:
            'Consider simplifying this passage — readers are struggling.',
        });
      }

      // Fast skip detection
      if (timeRatio < 0.3 && this.isEnabled('fast-skip')) {
        signals.push({
          blockId: blockData.blockId,
          type: 'fast-skip',
          value: 1 - timeRatio,
          label: `${((1 - timeRatio) * 100).toFixed(
            0
          )}% of expected reading time — readers skip this`,
          color: 'hsla(200, 60%, 50%, 0.4)',
          intensity: 'subtle',
          suggestion: 'This section may be redundant or uninteresting.',
        });
      }

      // Re-read detection
      if (blockData.reReadRate > 0.2 && this.isEnabled('re-read')) {
        signals.push({
          blockId: blockData.blockId,
          type: 're-read',
          value: blockData.reReadRate,
          label: `${(blockData.reReadRate * 100).toFixed(
            0
          )}% of readers re-read this`,
          color: 'hsla(50, 80%, 55%, 0.6)',
          intensity: blockData.reReadRate > 0.4 ? 'strong' : 'medium',
          suggestion:
            blockData.reReadRate > 0.4
              ? 'High re-read rate suggests this is confusing. Consider rewriting for clarity.'
              : 'Moderate re-read rate — this is dense but may be intentionally so.',
        });
      }

      // Drop-off detection
      if (blockData.dropOffRate > 0.15 && this.isEnabled('drop-off')) {
        signals.push({
          blockId: blockData.blockId,
          type: 'drop-off',
          value: blockData.dropOffRate,
          label: `${(blockData.dropOffRate * 100).toFixed(
            0
          )}% of readers leave here`,
          color: 'hsla(0, 80%, 55%, 0.6)',
          intensity: blockData.dropOffRate > 0.3 ? 'strong' : 'medium',
          suggestion:
            'Major drop-off point. Consider restructuring to maintain momentum.',
        });
      }

      // Highlight/delight detection
      if (blockData.highlightRate > 0.1 && this.isEnabled('highlight')) {
        signals.push({
          blockId: blockData.blockId,
          type: 'highlight',
          value: blockData.highlightRate,
          label: `${(blockData.highlightRate * 100).toFixed(
            0
          )}% of readers highlight this`,
          color: 'hsla(264, 70%, 60%, 0.5)',
          intensity: 'medium',
        });
      }

      // Share detection
      if (blockData.shareRate > 0.05 && this.isEnabled('share')) {
        signals.push({
          blockId: blockData.blockId,
          type: 'share',
          value: blockData.shareRate,
          label: `${(blockData.shareRate * 100).toFixed(
            0
          )}% of readers share from here`,
          color: 'hsla(140, 70%, 50%, 0.5)',
          intensity: 'medium',
        });
      }

      // Compound signals: confusion = slow + re-read + possibly drop-off
      if (
        timeRatio > 2 &&
        blockData.reReadRate > 0.3 &&
        this.isEnabled('confusion')
      ) {
        signals.push({
          blockId: blockData.blockId,
          type: 'confusion',
          value: Math.min(1, (timeRatio - 2) / 3 + blockData.reReadRate),
          label: 'Readers are confused here (slow + re-read pattern)',
          color: 'hsla(0, 70%, 60%, 0.7)',
          intensity: 'strong',
          suggestion:
            'This is your most confusing passage. Rewrite or add context.',
        });
      }

      // Compound signals: delight = highlight + share + linger
      if (
        blockData.highlightRate > 0.1 &&
        blockData.shareRate > 0.03 &&
        this.isEnabled('delight')
      ) {
        signals.push({
          blockId: blockData.blockId,
          type: 'delight',
          value: blockData.highlightRate + blockData.shareRate,
          label: 'Readers love this section (highlight + share pattern)',
          color: 'hsla(50, 90%, 55%, 0.6)',
          intensity: 'strong',
        });
      }

      if (signals.length > 0) {
        const filteredSignals = signals.filter((s) =>
          this.config.enabledSignals.includes(s.type)
        );

        if (filteredSignals.length > 0) {
          const hottest = filteredSignals.reduce((a, b) =>
            a.value > b.value ? a : b
          );

          const experienceScore = this.computeExperienceScore(blockData);

          this.annotations.set(blockData.blockId, {
            blockId: blockData.blockId,
            signals: filteredSignals,
            experienceScore,
            needsAttention: experienceScore < 0.4,
            gutterColor: hottest.color,
            tooltip: filteredSignals.map((s) => s.label).join('\n'),
          });
        }
      }
    }

    this.notify();
    return this.annotations;
  }

  /**
   * Get annotation for a specific block (for guttering/overlays).
   */
  getAnnotation(blockId: string): SymbiosisAnnotation | undefined {
    return this.annotations.get(blockId);
  }

  /**
   * Get all blocks that need writer attention, ranked by urgency.
   */
  getAttentionBlocks(): SymbiosisAnnotation[] {
    return Array.from(this.annotations.values())
      .filter((a) => a.needsAttention)
      .sort((a, b) => a.experienceScore - b.experienceScore);
  }

  /**
   * Get the overall document experience score.
   */
  getDocumentScore(): number {
    if (this.annotations.size === 0) return 1;
    let totalScore = 0;
    for (const annotation of this.annotations.values()) {
      totalScore += annotation.experienceScore;
    }
    return totalScore / this.annotations.size;
  }

  /**
   * Generate a plain-language summary of reader behavior.
   */
  getSummary(): string {
    const attention = this.getAttentionBlocks();
    const score = this.getDocumentScore();

    if (attention.length === 0) {
      return `Readers are engaging well across all sections (${(
        score * 100
      ).toFixed(0)}% experience score).`;
    }

    const worst = attention[0];
    const worstSignal = worst.signals.reduce((a, b) =>
      a.value > b.value ? a : b
    );

    return (
      `${attention.length} section${
        attention.length > 1 ? 's' : ''
      } need attention. ` +
      `Biggest issue: ${worstSignal.label}. ` +
      `Overall experience: ${(score * 100).toFixed(0)}%.`
    );
  }

  /**
   * Listen for annotation changes.
   */
  onChange(
    listener: (annotations: Map<string, SymbiosisAnnotation>) => void
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── Private ───────────────────────────────────────────────────

  private computeExperienceScore(data: AggregatedReaderData): number {
    let score = 1;

    // Penalize for confusion indicators
    const timeRatio = data.avgTimeMs / Math.max(1, data.expectedTimeMs);
    if (timeRatio > 3) score -= 0.3;
    if (data.reReadRate > 0.3) score -= 0.2;
    if (data.dropOffRate > 0.15) score -= 0.3;

    // Bonus for engagement indicators
    if (data.highlightRate > 0.1) score += 0.1;
    if (data.shareRate > 0.05) score += 0.15;

    return Math.max(0, Math.min(1, score));
  }

  private isEnabled(type: ReaderSignalType): boolean {
    return this.config.enabledSignals.includes(type);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.annotations);
    }
  }
}
