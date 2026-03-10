/**
 * SemanticBacklinks — Wiki-style linking from embedding similarity
 *
 * Ghost has backlinks by URL. Notion has page links.
 * We have something neither can: automatic semantic backlinks.
 *
 * Every block has an embedding. When you write something that
 * is semantically close to something written elsewhere — in
 * this document, another document, or across the whole corpus —
 * we surface that connection. No explicit link needed.
 *
 * The link graph emerges from the vector space.
 */

// ── Types ───────────────────────────────────────────────────────────

export interface Backlink {
  /** Source block/document that references us */
  readonly sourceBlockId: string;
  /** Source document ID */
  readonly sourceDocumentId: string;
  /** Source document title */
  readonly sourceDocumentTitle: string;
  /** Source text excerpt */
  readonly sourceExcerpt: string;
  /** Type of backlink */
  readonly linkType: BacklinkType;
  /** Similarity score (0-1) */
  readonly similarity: number;
  /** Whether this is an explicit link or a discovered semantic one */
  readonly isExplicit: boolean;
  /** Discovery timestamp */
  readonly discoveredAt: string;
}

export type BacklinkType =
  | 'semantic' // Discovered via embedding similarity
  | 'explicit' // Manual [[wiki-style]] link
  | 'entity-coref' // Same entity mentioned in both
  | 'citation' // One cites/references the other
  | 'continuation'; // Semantic continuation of thought across docs

export interface BacklinkIndex {
  /** Block ID → backlinks pointing TO it */
  readonly incoming: Map<string, Backlink[]>;
  /** Block ID → backlinks pointing FROM it */
  readonly outgoing: Map<string, Backlink[]>;
}

export interface BacklinkConfig {
  /** Minimum similarity threshold for semantic backlinks (0-1, default: 0.7) */
  readonly similarityThreshold?: number;
  /** Maximum number of backlinks per block (default: 10) */
  readonly maxBacklinksPerBlock?: number;
  /** Whether to search across documents (default: true) */
  readonly crossDocument?: boolean;
  /** Function to query other documents' embeddings */
  readonly queryCorpus?: (
    embedding: Float32Array,
    topK: number
  ) => Promise<
    Array<{
      blockId: string;
      documentId: string;
      documentTitle: string;
      text: string;
      similarity: number;
    }>
  >;
}

// ── Semantic Backlinks Engine ────────────────────────────────────────

export class SemanticBacklinks {
  private config: Required<Omit<BacklinkConfig, 'queryCorpus'>> & {
    queryCorpus?: BacklinkConfig['queryCorpus'];
  };
  private index: BacklinkIndex = {
    incoming: new Map(),
    outgoing: new Map(),
  };
  private explicitLinks: Map<string, Set<string>> = new Map();
  private listeners: Set<(blockId: string, backlinks: Backlink[]) => void> =
    new Set();

  constructor(config: BacklinkConfig = {}) {
    this.config = {
      similarityThreshold: config.similarityThreshold ?? 0.7,
      maxBacklinksPerBlock: config.maxBacklinksPerBlock ?? 10,
      crossDocument: config.crossDocument ?? true,
      queryCorpus: config.queryCorpus,
    };
  }

  /**
   * Index all blocks within a single document for intra-document backlinks.
   */
  indexDocument(
    documentId: string,
    documentTitle: string,
    blocks: Array<{
      id: string;
      text: string;
      embedding: Float32Array;
      entities: Array<{ canonical: string; type: string }>;
    }>
  ): void {
    // Parse explicit [[wiki-links]] from text
    for (const block of blocks) {
      const wikiLinks = this.extractWikiLinks(block.text);
      for (const target of wikiLinks) {
        if (!this.explicitLinks.has(block.id)) {
          this.explicitLinks.set(block.id, new Set());
        }
        this.explicitLinks.get(block.id)!.add(target);
      }
    }

    // Compute pairwise similarity within document
    for (let i = 0; i < blocks.length; i++) {
      const backlinks: Backlink[] = [];

      for (let j = 0; j < blocks.length; j++) {
        if (i === j) continue;

        const sim = this.cosineSimilarity(
          blocks[i].embedding,
          blocks[j].embedding
        );
        if (sim < this.config.similarityThreshold) continue;

        // Check for entity coreference
        const sharedEntities = blocks[i].entities.filter((e) =>
          blocks[j].entities.some((f) => f.canonical === e.canonical)
        );

        const linkType: BacklinkType =
          sharedEntities.length > 0
            ? 'entity-coref'
            : Math.abs(i - j) === 1
            ? 'continuation'
            : 'semantic';

        backlinks.push({
          sourceBlockId: blocks[j].id,
          sourceDocumentId: documentId,
          sourceDocumentTitle: documentTitle,
          sourceExcerpt: blocks[j].text.slice(0, 120),
          linkType,
          similarity: sim,
          isExplicit: false,
          discoveredAt: new Date().toISOString(),
        });
      }

      // Sort by similarity, limit
      backlinks.sort((a, b) => b.similarity - a.similarity);
      const limited = backlinks.slice(0, this.config.maxBacklinksPerBlock);

      this.index.incoming.set(blocks[i].id, limited);
    }
  }

  /**
   * Discover cross-document backlinks for a block.
   */
  async discoverCrossDocument(
    blockId: string,
    embedding: Float32Array
  ): Promise<Backlink[]> {
    if (!this.config.crossDocument || !this.config.queryCorpus) return [];

    const results = await this.config.queryCorpus(
      embedding,
      this.config.maxBacklinksPerBlock
    );

    const backlinks: Backlink[] = results
      .filter((r) => r.similarity >= this.config.similarityThreshold)
      .map((r) => ({
        sourceBlockId: r.blockId,
        sourceDocumentId: r.documentId,
        sourceDocumentTitle: r.documentTitle,
        sourceExcerpt: r.text.slice(0, 120),
        linkType: 'semantic' as BacklinkType,
        similarity: r.similarity,
        isExplicit: false,
        discoveredAt: new Date().toISOString(),
      }));

    // Merge with existing
    const existing = this.index.incoming.get(blockId) ?? [];
    const merged = [...existing, ...backlinks]
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, this.config.maxBacklinksPerBlock);

    this.index.incoming.set(blockId, merged);
    this.notify(blockId, merged);
    return backlinks;
  }

  /**
   * Register an explicit [[wiki-link]].
   */
  addExplicitLink(
    fromBlockId: string,
    toBlockId: string,
    sourceDoc: {
      documentId: string;
      documentTitle: string;
      excerpt: string;
    }
  ): void {
    const backlink: Backlink = {
      sourceBlockId: fromBlockId,
      sourceDocumentId: sourceDoc.documentId,
      sourceDocumentTitle: sourceDoc.documentTitle,
      sourceExcerpt: sourceDoc.excerpt,
      linkType: 'explicit',
      similarity: 1.0,
      isExplicit: true,
      discoveredAt: new Date().toISOString(),
    };

    const existing = this.index.incoming.get(toBlockId) ?? [];
    this.index.incoming.set(toBlockId, [backlink, ...existing]);
    this.notify(toBlockId, this.index.incoming.get(toBlockId)!);
  }

  /**
   * Get all backlinks pointing to a block.
   */
  getBacklinks(blockId: string): Backlink[] {
    return this.index.incoming.get(blockId) ?? [];
  }

  /**
   * Get all outgoing links from a block.
   */
  getOutgoingLinks(blockId: string): Backlink[] {
    return this.index.outgoing.get(blockId) ?? [];
  }

  /**
   * Listen for backlink changes on a specific block.
   */
  onChange(
    listener: (blockId: string, backlinks: Backlink[]) => void
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── Private ───────────────────────────────────────────────────

  private extractWikiLinks(text: string): string[] {
    const matches = text.matchAll(/\[\[([^\]]+)\]\]/g);
    return Array.from(matches, (m) => m[1]);
  }

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

  private notify(blockId: string, backlinks: Backlink[]): void {
    for (const listener of this.listeners) {
      listener(blockId, backlinks);
    }
  }
}
