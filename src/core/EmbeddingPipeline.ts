/**
 * EmbeddingPipeline — Real-time embedding computation
 *
 * Runs asynchronously (designed for the WASM worker) to keep
 * the UI thread free. On every text change, debounces and
 * re-embeds, re-classifies, and re-extracts entities.
 */

import type {
  EmbeddingDocument,
  EmbeddedNode,
  Entity,
  Classification,
} from './EmbeddingDocument';

// ── ESI Bridge Types ────────────────────────────────────────────────

/** Interface for the ESI embedding service */
export interface EmbeddingService {
  /** Compute a 384-dim embedding for text */
  embed(text: string): Promise<Float32Array>;
}

/** Interface for the ESI entity extraction service */
export interface EntityExtractionService {
  /** Extract named entities from text */
  extractEntities(text: string): Promise<Entity[]>;
}

/** Interface for the ESI classification service */
export interface ClassificationService {
  /** Classify text (topic, sentiment, intent) */
  classify(text: string): Promise<Classification>;
}

// ── Pipeline Configuration ──────────────────────────────────────────

export interface PipelineConfig {
  /** Debounce delay for re-embedding after text changes (ms) */
  debounceMs: number;
  /** Whether to run entity extraction on every change */
  enableEntities: boolean;
  /** Whether to run classification on every change */
  enableClassification: boolean;
  /** Embedding dimensions (default: 384 for bge-small-en-v1.5) */
  embeddingDimensions: number;
}

const DEFAULT_CONFIG: PipelineConfig = {
  debounceMs: 300,
  enableEntities: true,
  enableClassification: true,
  embeddingDimensions: 384,
};

// ── Pipeline ────────────────────────────────────────────────────────

/**
 * The EmbeddingPipeline watches for text changes on EmbeddedNodes
 * and asynchronously re-computes their embeddings, entities,
 * and classifications.
 *
 * Design: all heavy computation happens here (or in WASM worker),
 * never on the main rendering thread.
 */
export class EmbeddingPipeline {
  private readonly config: PipelineConfig;
  private readonly embeddingService: EmbeddingService;
  private readonly entityService: EntityExtractionService;
  private readonly classificationService: ClassificationService;

  /** Pending debounced re-embed timers per node ID */
  private pendingTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  /** Currently in-flight embedding requests */
  private inflight: Set<string> = new Set();

  /** Listeners for embedding completion events */
  private listeners: Set<PipelineListener> = new Set();

  constructor(
    embeddingService: EmbeddingService,
    entityService: EntityExtractionService,
    classificationService: ClassificationService,
    config: Partial<PipelineConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.embeddingService = embeddingService;
    this.entityService = entityService;
    this.classificationService = classificationService;
  }

  /**
   * Schedule a re-embedding of a node after text changes.
   * Debounced: rapid edits only trigger one embedding call.
   */
  scheduleReEmbed(doc: EmbeddingDocument, nodeId: string): void {
    // Cancel any pending timer for this node
    const existing = this.pendingTimers.get(nodeId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.pendingTimers.delete(nodeId);
      void this.processNode(doc, nodeId);
    }, this.config.debounceMs);

    this.pendingTimers.set(nodeId, timer);
  }

  /**
   * Immediately embed a node (skip debounce).
   * Used for initial document load or batch operations.
   */
  async embedNow(doc: EmbeddingDocument, nodeId: string): Promise<void> {
    // Cancel any pending timer
    const existing = this.pendingTimers.get(nodeId);
    if (existing) {
      clearTimeout(existing);
      this.pendingTimers.delete(nodeId);
    }
    await this.processNode(doc, nodeId);
  }

  /**
   * Embed all nodes in the document.
   * Used for initial load or full re-indexing.
   */
  async embedAll(doc: EmbeddingDocument): Promise<void> {
    const nodes = doc.getOrderedNodes();
    // Process in parallel batches of 10
    const batchSize = 10;
    for (let i = 0; i < nodes.length; i += batchSize) {
      const batch = nodes.slice(i, i + batchSize);
      await Promise.all(batch.map((node) => this.processNode(doc, node.id)));
    }
  }

  /** Register a listener for embedding completion events */
  onComplete(listener: PipelineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Get the set of node IDs currently being embedded */
  getInflight(): ReadonlySet<string> {
    return this.inflight;
  }

  /** Cancel all pending re-embed timers */
  dispose(): void {
    for (const timer of this.pendingTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
    this.listeners.clear();
  }

  // ── Private ───────────────────────────────────────────────────

  private async processNode(
    doc: EmbeddingDocument,
    nodeId: string
  ): Promise<void> {
    const node = doc.getNode(nodeId);
    if (!node) return;
    if (this.inflight.has(nodeId)) return; // Already processing

    this.inflight.add(nodeId);

    try {
      // Run embedding, entity extraction, and classification in parallel
      const [embedding, entities, classification] = await Promise.all([
        this.embeddingService.embed(node.text),
        this.config.enableEntities
          ? this.entityService.extractEntities(node.text)
          : Promise.resolve(node.entities),
        this.config.enableClassification
          ? this.classificationService.classify(node.text)
          : Promise.resolve(node.classification),
      ]);

      // Link entities to canonical IDs
      const linkedEntities = this.linkEntities(entities, doc);

      // Update the node in the document
      doc.updateEmbedding(nodeId, embedding, linkedEntities, classification);

      // Notify listeners
      for (const listener of this.listeners) {
        listener({
          type: 'embedding-complete',
          nodeId,
          embedding,
          entities: linkedEntities,
          classification,
        });
      }
    } catch (error) {
      // Notify listeners of failure
      for (const listener of this.listeners) {
        listener({
          type: 'embedding-error',
          nodeId,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    } finally {
      this.inflight.delete(nodeId);
    }
  }

  /**
   * Link entities to canonical IDs.
   * If an entity matches an existing entity in the document
   * (same text, same type), assign it the same canonical ID.
   */
  private linkEntities(entities: Entity[], doc: EmbeddingDocument): Entity[] {
    const existingEntities = doc.getAllEntities();

    return entities.map((entity) => {
      // Check if this entity already has a canonical ID
      if (entity.canonicalId) return entity;

      // Look for a matching entity in the registry
      for (const [canonicalId, refs] of existingEntities) {
        for (const ref of refs) {
          if (
            ref.text.toLowerCase() === entity.text.toLowerCase() &&
            ref.type === entity.type
          ) {
            return { ...entity, canonicalId };
          }
        }
      }

      // New entity — generate a canonical ID
      const canonicalId = `entity-${entity.type}-${entity.text
        .toLowerCase()
        .replace(/\s+/g, '-')}`;
      return { ...entity, canonicalId };
    });
  }
}

// ── Events ──────────────────────────────────────────────────────────

export type PipelineEvent =
  | {
      type: 'embedding-complete';
      nodeId: string;
      embedding: Float32Array;
      entities: Entity[];
      classification: Classification;
    }
  | {
      type: 'embedding-error';
      nodeId: string;
      error: Error;
    };

export type PipelineListener = (event: PipelineEvent) => void;
