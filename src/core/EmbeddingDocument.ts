/**
 * @affectively/aeon-flux-capacitor — Embedding Core
 *
 * The fundamental data model. Every block is a point in vector space
 * with positional encoding, entity annotations, and semantic classification.
 * Text is just one projection of this underlying representation.
 */

// ── Types ───────────────────────────────────────────────────────────

/** Supported entity types from GLiNER-based NER */
export type EntityType =
  | 'person'
  | 'organization'
  | 'location'
  | 'date'
  | 'event'
  | 'concept'
  | 'product'
  | 'quantity';

/** A named entity extracted from text */
export interface Entity {
  /** The entity text as it appears in the source */
  readonly text: string;
  /** Classified entity type */
  readonly type: EntityType;
  /** Character offset (start) within the block's text */
  readonly start: number;
  /** Character offset (end) within the block's text */
  readonly end: number;
  /** Confidence score from the NER model (0-1) */
  readonly confidence: number;
  /** Canonical ID for entity linking (same entity across blocks) */
  readonly canonicalId?: string;
}

/** Semantic classification of a block */
export interface Classification {
  /** Primary topic label */
  readonly topic: string;
  /** Sentiment polarity (-1 to 1) */
  readonly sentiment: number;
  /** Detected intent (informational, persuasive, narrative, etc.) */
  readonly intent: string;
  /** Classification confidence (0-1) */
  readonly confidence: number;
}

/** Metadata for revision tracking and attribution */
export interface NodeMetadata {
  /** DID of the author */
  readonly authorDid: string;
  /** ISO-8601 creation timestamp */
  readonly createdAt: string;
  /** ISO-8601 last modification timestamp */
  readonly updatedAt: string;
  /** Revision ID this node belongs to */
  readonly revisionId: string;
  /** Lock state */
  readonly lockState?: {
    readonly lockedBy: string;
    readonly lockedAt: string;
    readonly expiresAt: string;
  };
}

/**
 * The core unit of the Embedding Editor.
 * Every block is simultaneously a vector, a position, an entity graph,
 * and a text string. The text is the derivative — the vector is primary.
 */
export interface EmbeddedNode {
  /** Content-addressable block ID */
  readonly id: string;

  /** 384-dimensional embedding vector (bge-small-en-v1.5) */
  embedding: Float32Array;

  /**
   * Positional encoding — sinusoidal signal encoding:
   * - Block order in the document sequence
   * - Section/heading depth
   * - Paragraph index within section
   */
  positionalEncoding: Float32Array;

  /** Extracted named entities */
  entities: Entity[];

  /** Semantic classification (topic, sentiment, intent) */
  classification: Classification;

  /** The human-readable projection of this embedding */
  text: string;

  /** Block type in the CRDT tree */
  blockType: BlockType;

  /** Attribution and revision metadata */
  metadata: NodeMetadata;
}

/** Block types in the document tree */
export type BlockType =
  | 'paragraph'
  | 'heading'
  | 'list'
  | 'list-item'
  | 'blockquote'
  | 'code'
  | 'embed'
  | 'image'
  | 'divider'
  | 'table'
  | 'callout'
  | 'esi';

/** Heading level (1-6) metadata */
export interface HeadingMeta {
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
}

/** Code block metadata */
export interface CodeMeta {
  readonly language: string;
  readonly lineNumbers?: boolean;
}

/** ESI block metadata */
export interface ESIMeta {
  readonly tagName: string;
  readonly props: Record<string, unknown>;
}

// ── Embedding Document ──────────────────────────────────────────────

/**
 * The top-level embedding document.
 * A collection of EmbeddedNodes forming a semantic space,
 * with the text rendering being just one view into that space.
 */
export class EmbeddingDocument {
  /** Document ID */
  readonly id: string;

  /** All embedded nodes, ordered by document position */
  private nodes: Map<string, EmbeddedNode> = new Map();

  /** Ordered node IDs (document sequence) */
  private order: string[] = [];

  /** Entity registry — canonical entities across the document */
  private entityRegistry: Map<string, Entity[]> = new Map();

  constructor(id: string) {
    this.id = id;
  }

  // ── Node Operations ───────────────────────────────────────────

  /** Get a node by ID */
  getNode(id: string): EmbeddedNode | undefined {
    return this.nodes.get(id);
  }

  /** Get all nodes in document order */
  getOrderedNodes(): EmbeddedNode[] {
    return this.order.map((id) => this.nodes.get(id)!).filter(Boolean);
  }

  /** Get the total node count */
  get size(): number {
    return this.nodes.size;
  }

  /**
   * Insert a new embedded node at the given position.
   * The embedding will be computed asynchronously by the pipeline.
   */
  insertNode(node: EmbeddedNode, position: number): void {
    this.nodes.set(node.id, node);
    this.order.splice(position, 0, node.id);
    this.recomputePositionalEncodings();
    this.indexEntities(node);
  }

  /** Remove a node by ID */
  removeNode(id: string): boolean {
    const existed = this.nodes.delete(id);
    if (existed) {
      this.order = this.order.filter((nid) => nid !== id);
      this.recomputePositionalEncodings();
      this.deindexEntities(id);
    }
    return existed;
  }

  /** Move a node from one position to another */
  moveNode(id: string, newPosition: number): void {
    const currentIndex = this.order.indexOf(id);
    if (currentIndex === -1) return;
    this.order.splice(currentIndex, 1);
    this.order.splice(newPosition, 0, id);
    this.recomputePositionalEncodings();
  }

  /**
   * Update a node's text — triggers re-embedding.
   * Returns the updated node. The embedding field will be stale
   * until the EmbeddingPipeline re-computes it.
   */
  updateText(id: string, newText: string): EmbeddedNode | undefined {
    const node = this.nodes.get(id);
    if (!node) return undefined;

    const updated: EmbeddedNode = {
      ...node,
      text: newText,
      metadata: {
        ...node.metadata,
        updatedAt: new Date().toISOString(),
      },
    };
    this.nodes.set(id, updated);
    return updated;
  }

  /**
   * Update a node's embedding (called by EmbeddingPipeline after inference).
   */
  updateEmbedding(
    id: string,
    embedding: Float32Array,
    entities: Entity[],
    classification: Classification
  ): void {
    const node = this.nodes.get(id);
    if (!node) return;

    this.nodes.set(id, {
      ...node,
      embedding,
      entities,
      classification,
    });
    this.deindexEntities(id);
    this.indexEntities(this.nodes.get(id)!);
  }

  // ── Search ────────────────────────────────────────────────────

  /**
   * Find nodes semantically similar to a query embedding.
   * Uses cosine similarity over the 384-dim vectors.
   */
  findSimilar(
    queryEmbedding: Float32Array,
    topK: number = 5,
    threshold: number = 0.7
  ): Array<{ node: EmbeddedNode; similarity: number }> {
    const results: Array<{ node: EmbeddedNode; similarity: number }> = [];

    for (const node of this.nodes.values()) {
      if (node.embedding.length === 0) continue;
      const similarity = cosineSimilarity(queryEmbedding, node.embedding);
      if (similarity >= threshold) {
        results.push({ node, similarity });
      }
    }

    return results.sort((a, b) => b.similarity - a.similarity).slice(0, topK);
  }

  /**
   * Find all blocks mentioning a given entity (by canonical ID).
   */
  findByEntity(canonicalId: string): EmbeddedNode[] {
    const entityRefs = this.entityRegistry.get(canonicalId);
    if (!entityRefs) return [];

    const nodeIds = new Set<string>();
    for (const node of this.nodes.values()) {
      for (const entity of node.entities) {
        if (entity.canonicalId === canonicalId) {
          nodeIds.add(node.id);
        }
      }
    }

    return Array.from(nodeIds)
      .map((id) => this.nodes.get(id)!)
      .filter(Boolean);
  }

  /**
   * Get all unique entities in the document, grouped by canonical ID.
   */
  getAllEntities(): Map<string, Entity[]> {
    return new Map(this.entityRegistry);
  }

  // ── Serialization ─────────────────────────────────────────────

  /** Serialize the full document to a transferable format */
  serialize(): SerializedEmbeddingDocument {
    return {
      id: this.id,
      nodes: this.getOrderedNodes().map(serializeNode),
      order: [...this.order],
    };
  }

  /** Restore from serialized format */
  static deserialize(data: SerializedEmbeddingDocument): EmbeddingDocument {
    const doc = new EmbeddingDocument(data.id);
    for (const serialized of data.nodes) {
      const node = deserializeNode(serialized);
      doc.nodes.set(node.id, node);
    }
    doc.order = [...data.order];

    // Rebuild entity registry
    for (const node of doc.nodes.values()) {
      doc.indexEntities(node);
    }
    return doc;
  }

  // ── Private ───────────────────────────────────────────────────

  /**
   * Recompute positional encodings for all nodes.
   * Uses sinusoidal encoding: PE(pos, 2i) = sin(pos / 10000^(2i/d))
   */
  private recomputePositionalEncodings(): void {
    const d = 64; // positional encoding dimensions
    for (let pos = 0; pos < this.order.length; pos++) {
      const node = this.nodes.get(this.order[pos]);
      if (!node) continue;

      const pe = new Float32Array(d);
      for (let i = 0; i < d; i += 2) {
        const angle = pos / Math.pow(10000, (2 * i) / d);
        pe[i] = Math.sin(angle);
        if (i + 1 < d) {
          pe[i + 1] = Math.cos(angle);
        }
      }
      node.positionalEncoding = pe;
    }
  }

  /** Index a node's entities in the entity registry */
  private indexEntities(node: EmbeddedNode): void {
    for (const entity of node.entities) {
      if (!entity.canonicalId) continue;
      const existing = this.entityRegistry.get(entity.canonicalId) || [];
      existing.push(entity);
      this.entityRegistry.set(entity.canonicalId, existing);
    }
  }

  /** Remove a node's entities from the entity registry */
  private deindexEntities(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    for (const entity of node.entities) {
      if (!entity.canonicalId) continue;
      const existing = this.entityRegistry.get(entity.canonicalId);
      if (existing) {
        const filtered = existing.filter(
          (e) => e.start !== entity.start || e.end !== entity.end
        );
        if (filtered.length === 0) {
          this.entityRegistry.delete(entity.canonicalId);
        } else {
          this.entityRegistry.set(entity.canonicalId, filtered);
        }
      }
    }
  }
}

// ── Serialization Helpers ───────────────────────────────────────────

export interface SerializedEmbeddedNode {
  id: string;
  embedding: number[];
  positionalEncoding: number[];
  entities: Entity[];
  classification: Classification;
  text: string;
  blockType: BlockType;
  metadata: NodeMetadata;
}

export interface SerializedEmbeddingDocument {
  id: string;
  nodes: SerializedEmbeddedNode[];
  order: string[];
}

function serializeNode(node: EmbeddedNode): SerializedEmbeddedNode {
  return {
    ...node,
    embedding: Array.from(node.embedding),
    positionalEncoding: Array.from(node.positionalEncoding),
  };
}

function deserializeNode(data: SerializedEmbeddedNode): EmbeddedNode {
  return {
    ...data,
    embedding: new Float32Array(data.embedding),
    positionalEncoding: new Float32Array(data.positionalEncoding),
  };
}

// ── Math Utilities ──────────────────────────────────────────────────

/** Cosine similarity between two vectors */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Create a blank EmbeddedNode with default values.
 * Embedding will be populated by the EmbeddingPipeline.
 */
export function createEmbeddedNode(
  id: string,
  text: string,
  blockType: BlockType,
  authorDid: string
): EmbeddedNode {
  const now = new Date().toISOString();
  return {
    id,
    embedding: new Float32Array(384),
    positionalEncoding: new Float32Array(64),
    entities: [],
    classification: {
      topic: '',
      sentiment: 0,
      intent: 'informational',
      confidence: 0,
    },
    text,
    blockType,
    metadata: {
      authorDid,
      createdAt: now,
      updatedAt: now,
      revisionId: '',
    },
  };
}
