/**
 * DocumentSearch — Semantic search within and across documents
 *
 * We have embeddings for every block. The infrastructure is there.
 * This module makes it usable: type a query, get semantically
 * matched results ranked by embedding similarity — not just
 * string matching.
 *
 * Also supports: fuzzy text search as fallback, combined ranking,
 * search-as-you-type with streaming results, and scope filtering.
 */

// ── Types ───────────────────────────────────────────────────────────

export interface SearchResult {
  /** Block ID */
  readonly blockId: string;
  /** Document ID */
  readonly documentId: string;
  /** Document title */
  readonly documentTitle: string;
  /** Matched text excerpt */
  readonly excerpt: string;
  /** Semantic similarity score (0-1) */
  readonly semanticScore: number;
  /** Text match score (0-1), if applicable */
  readonly textScore: number;
  /** Combined score */
  readonly combinedScore: number;
  /** Match highlights (character ranges) */
  readonly highlights: Array<{ start: number; end: number }>;
  /** Matched block type */
  readonly blockType: string;
}

export interface SearchConfig {
  /** Function to embed a query string */
  readonly embedQuery: (query: string) => Promise<Float32Array>;
  /** Maximum results */
  readonly maxResults?: number;
  /** Semantic weight vs text weight (0 = text only, 1 = semantic only, default: 0.7) */
  readonly semanticWeight?: number;
  /** Minimum score threshold (default: 0.3) */
  readonly minScore?: number;
}

export type SearchScope = 'document' | 'corpus' | 'all';

interface IndexedBlock {
  readonly blockId: string;
  readonly documentId: string;
  readonly documentTitle: string;
  readonly text: string;
  readonly textLower: string;
  readonly embedding: Float32Array;
  readonly blockType: string;
}

// ── Document Search Engine ──────────────────────────────────────────

export class DocumentSearch {
  private config: Required<Omit<SearchConfig, 'embedQuery'>> &
    Pick<SearchConfig, 'embedQuery'>;
  private blocks: IndexedBlock[] = [];
  private documentIndex: Map<string, IndexedBlock[]> = new Map();

  constructor(config: SearchConfig) {
    this.config = {
      embedQuery: config.embedQuery,
      maxResults: config.maxResults ?? 20,
      semanticWeight: config.semanticWeight ?? 0.7,
      minScore: config.minScore ?? 0.3,
    };
  }

  /**
   * Index a document's blocks for searching.
   */
  indexDocument(
    documentId: string,
    documentTitle: string,
    blocks: Array<{
      id: string;
      text: string;
      embedding: Float32Array;
      blockType: string;
    }>
  ): void {
    const indexed: IndexedBlock[] = blocks.map((b) => ({
      blockId: b.id,
      documentId,
      documentTitle,
      text: b.text,
      textLower: b.text.toLowerCase(),
      embedding: b.embedding,
      blockType: b.blockType,
    }));

    // Replace any existing blocks for this document
    this.blocks = this.blocks.filter((b) => b.documentId !== documentId);
    this.blocks.push(...indexed);
    this.documentIndex.set(documentId, indexed);
  }

  /**
   * Remove a document from the index.
   */
  removeDocument(documentId: string): void {
    this.blocks = this.blocks.filter((b) => b.documentId !== documentId);
    this.documentIndex.delete(documentId);
  }

  /**
   * Search with a natural language query.
   * Combines semantic embedding search with text matching.
   */
  async search(
    query: string,
    scope: SearchScope = 'all',
    scopeDocumentId?: string
  ): Promise<SearchResult[]> {
    if (!query.trim()) return [];

    const queryLower = query.toLowerCase();
    const queryEmbedding = await this.config.embedQuery(query);

    // Determine search scope
    let candidates: IndexedBlock[];
    if (scope === 'document' && scopeDocumentId) {
      candidates = this.documentIndex.get(scopeDocumentId) ?? [];
    } else {
      candidates = this.blocks;
    }

    const semanticWeight = this.config.semanticWeight;
    const textWeight = 1 - semanticWeight;

    const results: SearchResult[] = candidates
      .map((block) => {
        // Semantic score
        const semanticScore = this.cosineSimilarity(
          queryEmbedding,
          block.embedding
        );

        // Text score (fuzzy substring matching)
        const textScore = this.textMatchScore(queryLower, block.textLower);

        // Combined
        const combinedScore =
          semanticScore * semanticWeight + textScore * textWeight;

        // Find highlights
        const highlights = this.findHighlights(queryLower, block.textLower);

        return {
          blockId: block.blockId,
          documentId: block.documentId,
          documentTitle: block.documentTitle,
          excerpt: this.buildExcerpt(block.text, highlights),
          semanticScore,
          textScore,
          combinedScore,
          highlights,
          blockType: block.blockType,
        };
      })
      .filter((r) => r.combinedScore >= this.config.minScore)
      .sort((a, b) => b.combinedScore - a.combinedScore)
      .slice(0, this.config.maxResults);

    return results;
  }

  /**
   * Quick text-only search (no embedding computation, instant).
   */
  quickSearch(query: string, scopeDocumentId?: string): SearchResult[] {
    if (!query.trim()) return [];

    const queryLower = query.toLowerCase();
    const candidates = scopeDocumentId
      ? this.documentIndex.get(scopeDocumentId) ?? []
      : this.blocks;

    return candidates
      .map((block) => {
        const textScore = this.textMatchScore(queryLower, block.textLower);
        const highlights = this.findHighlights(queryLower, block.textLower);

        return {
          blockId: block.blockId,
          documentId: block.documentId,
          documentTitle: block.documentTitle,
          excerpt: this.buildExcerpt(block.text, highlights),
          semanticScore: 0,
          textScore,
          combinedScore: textScore,
          highlights,
          blockType: block.blockType,
        };
      })
      .filter((r) => r.textScore > 0)
      .sort((a, b) => b.textScore - a.textScore)
      .slice(0, this.config.maxResults);
  }

  /**
   * Get the total number of indexed blocks.
   */
  getIndexSize(): number {
    return this.blocks.length;
  }

  // ── Private ───────────────────────────────────────────────────

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
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

  private textMatchScore(query: string, text: string): number {
    if (text.includes(query)) {
      // Exact substring match — high score
      const frequency = text.split(query).length - 1;
      return Math.min(1, 0.7 + frequency * 0.1);
    }

    // Word-level matching
    const queryWords = query.split(/\s+/).filter(Boolean);
    if (queryWords.length === 0) return 0;

    let matchedWords = 0;
    for (const word of queryWords) {
      if (text.includes(word)) matchedWords++;
    }

    return (matchedWords / queryWords.length) * 0.6;
  }

  private findHighlights(
    query: string,
    textLower: string
  ): Array<{ start: number; end: number }> {
    const highlights: Array<{ start: number; end: number }> = [];

    // Find all occurrences of the full query
    let idx = textLower.indexOf(query);
    while (idx !== -1) {
      highlights.push({ start: idx, end: idx + query.length });
      idx = textLower.indexOf(query, idx + 1);
    }

    // Also find individual word matches
    if (highlights.length === 0) {
      const words = query.split(/\s+/).filter(Boolean);
      for (const word of words) {
        let widx = textLower.indexOf(word);
        while (widx !== -1) {
          highlights.push({ start: widx, end: widx + word.length });
          widx = textLower.indexOf(word, widx + 1);
        }
      }
    }

    return highlights.sort((a, b) => a.start - b.start);
  }

  private buildExcerpt(
    text: string,
    highlights: Array<{ start: number; end: number }>,
    maxLength = 150
  ): string {
    if (highlights.length === 0) return text.slice(0, maxLength);

    // Center the excerpt around the first highlight
    const center = highlights[0].start;
    const start = Math.max(0, center - Math.floor(maxLength / 2));
    const end = Math.min(text.length, start + maxLength);

    let excerpt = text.slice(start, end);
    if (start > 0) excerpt = '…' + excerpt;
    if (end < text.length) excerpt = excerpt + '…';

    return excerpt;
  }
}
