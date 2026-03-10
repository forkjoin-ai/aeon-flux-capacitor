/**
 * KnowledgeFabric — On-demand content from existing stores
 *
 * The next level beyond backlinks.
 *
 * SemanticBacklinks says "these two things are related."
 * KnowledgeFabric says "here's the relevant knowledge you
 * need right now, pulled from your entire corpus."
 *
 * While you write, the fabric monitors your embeddings and
 * automatically surfaces:
 *   - Relevant paragraphs from other documents
 *   - Supporting evidence for claims you're making
 *   - Contradicting evidence you should address
 *   - Prior writing on the same topic (your own voice)
 *   - Reference material that strengthens the current section
 *
 * It's not search. You don't ask. It just knows.
 */

// ── Types ───────────────────────────────────────────────────────────

export interface FabricSuggestion {
  /** Unique ID */
  readonly id: string;
  /** Source document ID */
  readonly sourceDocumentId: string;
  /** Source document title */
  readonly sourceTitle: string;
  /** Source block ID within that document */
  readonly sourceBlockId: string;
  /** The relevant text from the source */
  readonly text: string;
  /** Embedding similarity (0-1) */
  readonly similarity: number;
  /** Relationship to the current block */
  readonly relationship: FabricRelationship;
  /** How the suggestion could be used */
  readonly usage: FabricUsage;
  /** Whether the author has seen this suggestion */
  seen: boolean;
  /** Whether the author has dismissed/used this */
  resolved: boolean;
}

export type FabricRelationship =
  | 'supporting' // evidence that supports the current claim
  | 'contradicting' // evidence that contradicts the current claim
  | 'extending' // extends the current idea further
  | 'prior-art' // you've written about this before
  | 'reference' // factual/reference material
  | 'parallel' // similar argument in different context
  | 'foundation'; // prerequisite knowledge for the current section

export type FabricUsage =
  | 'cite' // quote or cite this in your text
  | 'refute' // address this contradiction
  | 'merge' // combine with existing content
  | 'link' // add a cross-reference
  | 'absorb' // internalize the knowledge, don't cite
  | 'ignore'; // not relevant despite similarity

export interface FabricConfig {
  /** Function to search the corpus by embedding */
  readonly corpusSearch: (
    embedding: Float32Array,
    options: { limit: number; excludeDocId?: string; minSimilarity?: number }
  ) => Promise<
    Array<{
      documentId: string;
      documentTitle: string;
      blockId: string;
      text: string;
      similarity: number;
      embedding: Float32Array;
    }>
  >;
  /** Inference function for relationship classification */
  readonly inferFn?: (prompt: string) => Promise<string>;
  /** Minimum similarity threshold (default: 0.6) */
  readonly minSimilarity?: number;
  /** Maximum suggestions per block (default: 3) */
  readonly maxPerBlock?: number;
  /** Whether to auto-surface suggestions (default: true) */
  readonly autoSurface?: boolean;
  /** Debounce delay in ms for as-you-type surfacing */
  readonly debounceMs?: number;
}

// ── Knowledge Fabric Engine ─────────────────────────────────────────

export class KnowledgeFabric {
  private config: Required<Omit<FabricConfig, 'inferFn'>> & {
    inferFn?: (prompt: string) => Promise<string>;
  };
  private suggestions: Map<string, FabricSuggestion[]> = new Map(); // blockId → suggestions
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> =
    new Map();
  private listeners: Set<
    (blockId: string, suggestions: FabricSuggestion[]) => void
  > = new Set();

  constructor(config: FabricConfig) {
    this.config = {
      corpusSearch: config.corpusSearch,
      inferFn: config.inferFn,
      minSimilarity: config.minSimilarity ?? 0.6,
      maxPerBlock: config.maxPerBlock ?? 3,
      autoSurface: config.autoSurface ?? true,
      debounceMs: config.debounceMs ?? 1500,
    };
  }

  /**
   * Surface relevant knowledge for a block.
   * Call this as the author types — it will debounce internally.
   */
  surfaceForBlock(
    blockId: string,
    text: string,
    embedding: Float32Array,
    currentDocId: string
  ): void {
    if (!this.config.autoSurface) return;

    // Clear existing debounce
    const existing = this.debounceTimers.get(blockId);
    if (existing) clearTimeout(existing);

    // Debounce
    const timer = setTimeout(async () => {
      this.debounceTimers.delete(blockId);
      await this.fetchSuggestions(blockId, text, embedding, currentDocId);
    }, this.config.debounceMs);

    this.debounceTimers.set(blockId, timer);
  }

  /**
   * Immediately fetch suggestions (no debounce).
   */
  async fetchSuggestions(
    blockId: string,
    text: string,
    embedding: Float32Array,
    currentDocId: string
  ): Promise<FabricSuggestion[]> {
    // Query corpus
    const results = await this.config.corpusSearch(embedding, {
      limit: this.config.maxPerBlock * 2, // fetch extra for quality filtering
      excludeDocId: currentDocId,
      minSimilarity: this.config.minSimilarity,
    });

    // Classify relationships
    const suggestions: FabricSuggestion[] = [];

    for (const result of results) {
      const relationship = await this.classifyRelationship(
        text,
        result.text,
        result.similarity
      );
      const usage = this.suggestUsage(relationship);

      suggestions.push({
        id: `fab-${blockId}-${result.blockId}`,
        sourceDocumentId: result.documentId,
        sourceTitle: result.documentTitle,
        sourceBlockId: result.blockId,
        text: result.text,
        similarity: result.similarity,
        relationship,
        usage,
        seen: false,
        resolved: false,
      });
    }

    // Keep top N by relevance
    const topSuggestions = suggestions
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, this.config.maxPerBlock);

    this.suggestions.set(blockId, topSuggestions);
    this.notify(blockId, topSuggestions);

    return topSuggestions;
  }

  /**
   * Get current suggestions for a block.
   */
  getSuggestions(blockId: string): FabricSuggestion[] {
    return (this.suggestions.get(blockId) ?? []).filter((s) => !s.resolved);
  }

  /**
   * Get all active suggestions across the document.
   */
  getAllSuggestions(): Map<string, FabricSuggestion[]> {
    const active = new Map<string, FabricSuggestion[]>();
    for (const [blockId, suggestions] of this.suggestions) {
      const unresolvedSuggestions = suggestions.filter((s) => !s.resolved);
      if (unresolvedSuggestions.length > 0) {
        active.set(blockId, unresolvedSuggestions);
      }
    }
    return active;
  }

  /**
   * Mark a suggestion as used (accepted).
   */
  useSuggestion(suggestionId: string): FabricSuggestion | undefined {
    for (const suggestions of this.suggestions.values()) {
      const suggestion = suggestions.find((s) => s.id === suggestionId);
      if (suggestion) {
        suggestion.resolved = true;
        return suggestion;
      }
    }
    return undefined;
  }

  /**
   * Dismiss a suggestion.
   */
  dismissSuggestion(suggestionId: string): void {
    for (const suggestions of this.suggestions.values()) {
      const suggestion = suggestions.find((s) => s.id === suggestionId);
      if (suggestion) {
        suggestion.resolved = true;
      }
    }
  }

  /**
   * Get a count of unseen suggestions.
   */
  getUnseenCount(): number {
    let count = 0;
    for (const suggestions of this.suggestions.values()) {
      count += suggestions.filter((s) => !s.seen && !s.resolved).length;
    }
    return count;
  }

  /**
   * Listen for new suggestions.
   */
  onChange(
    listener: (blockId: string, suggestions: FabricSuggestion[]) => void
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Cleanup debounce timers.
   */
  dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  // ── Private ───────────────────────────────────────────────────

  private async classifyRelationship(
    currentText: string,
    sourceText: string,
    similarity: number
  ): Promise<FabricRelationship> {
    if (!this.config.inferFn) {
      return this.heuristicRelationship(similarity);
    }

    const response = await this.config.inferFn(
      `What is the relationship between these two texts?
      Reply with ONE word: supporting, contradicting, extending, prior-art, reference, parallel, foundation.

      Current writing: "${currentText.slice(0, 300)}"
      Source material: "${sourceText.slice(0, 300)}"`
    );

    const word = response.trim().toLowerCase();
    const valid: FabricRelationship[] = [
      'supporting',
      'contradicting',
      'extending',
      'prior-art',
      'reference',
      'parallel',
      'foundation',
    ];

    return valid.includes(word as FabricRelationship)
      ? (word as FabricRelationship)
      : this.heuristicRelationship(similarity);
  }

  private heuristicRelationship(similarity: number): FabricRelationship {
    if (similarity > 0.9) return 'prior-art';
    if (similarity > 0.8) return 'parallel';
    if (similarity > 0.7) return 'supporting';
    return 'reference';
  }

  private suggestUsage(relationship: FabricRelationship): FabricUsage {
    switch (relationship) {
      case 'supporting':
        return 'cite';
      case 'contradicting':
        return 'refute';
      case 'extending':
        return 'link';
      case 'prior-art':
        return 'merge';
      case 'reference':
        return 'cite';
      case 'parallel':
        return 'link';
      case 'foundation':
        return 'absorb';
    }
  }

  private notify(blockId: string, suggestions: FabricSuggestion[]): void {
    for (const listener of this.listeners) {
      listener(blockId, suggestions);
    }
  }
}
