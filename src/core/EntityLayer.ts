/**
 * EntityLayer — First-party entity extraction and NER
 *
 * Uses ESI.Entities for GLiNER-based NER and ESI.Redact for PII detection.
 * Maintains a document-wide entity registry with occurrence tracking,
 * cross-block linking, and an API for the entity panel sidebar.
 */

import type {
  EmbeddingDocument,
  Entity,
  EntityType,
} from './EmbeddingDocument';

// ── Types ───────────────────────────────────────────────────────────

/** A canonical entity with all its occurrences across the document */
export interface CanonicalEntity {
  /** Canonical ID */
  readonly id: string;
  /** Entity type */
  readonly type: EntityType;
  /** Display name (most common surface form) */
  readonly displayName: string;
  /** All surface forms (different spellings/references) */
  readonly surfaceForms: string[];
  /** Block IDs where this entity appears */
  readonly blockIds: string[];
  /** Total occurrence count */
  readonly occurrenceCount: number;
  /** Average confidence across all extractions */
  readonly avgConfidence: number;
}

/** PII detection result */
export interface PIIDetection {
  /** The PII text */
  readonly text: string;
  /** PII category */
  readonly category: PIICategory;
  /** Character offset (start) */
  readonly start: number;
  /** Character offset (end) */
  readonly end: number;
  /** Suggested redaction mask */
  readonly mask: string;
}

export type PIICategory =
  | 'name'
  | 'email'
  | 'phone'
  | 'address'
  | 'ssn'
  | 'credit-card'
  | 'date-of-birth'
  | 'ip-address'
  | 'other';

/** Entity change event */
export type EntityEvent =
  | { type: 'entity-added'; entity: CanonicalEntity }
  | { type: 'entity-updated'; entity: CanonicalEntity }
  | { type: 'entity-removed'; entityId: string }
  | { type: 'pii-detected'; blockId: string; detections: PIIDetection[] };

export type EntityListener = (event: EntityEvent) => void;

// ── Entity Layer ────────────────────────────────────────────────────

export class EntityLayer {
  /** Canonical entity registry */
  private entities: Map<string, CanonicalEntity> = new Map();

  /** Block ID → entity IDs mapping */
  private blockEntityIndex: Map<string, Set<string>> = new Map();

  /** PII detections per block */
  private piiDetections: Map<string, PIIDetection[]> = new Map();

  /** Event listeners */
  private listeners: Set<EntityListener> = new Set();

  /**
   * Rebuild the entity layer from a full EmbeddingDocument.
   * Scans all nodes and builds the entity registry.
   */
  rebuild(doc: EmbeddingDocument): void {
    this.entities.clear();
    this.blockEntityIndex.clear();

    for (const node of doc.getOrderedNodes()) {
      this.indexNodeEntities(node.id, node.entities);
    }
  }

  /**
   * Update entities for a specific block (called after embedding pipeline runs).
   */
  updateBlock(blockId: string, entities: Entity[]): void {
    // Remove old entries for this block
    this.deindexBlock(blockId);

    // Re-index with new entities
    this.indexNodeEntities(blockId, entities);
  }

  /**
   * Record PII detections for a block.
   */
  recordPII(blockId: string, detections: PIIDetection[]): void {
    this.piiDetections.set(blockId, detections);
    if (detections.length > 0) {
      this.emit({ type: 'pii-detected', blockId, detections });
    }
  }

  // ── Queries ───────────────────────────────────────────────────

  /** Get all canonical entities, sorted by occurrence count */
  getAllEntities(): CanonicalEntity[] {
    return Array.from(this.entities.values()).sort(
      (a, b) => b.occurrenceCount - a.occurrenceCount
    );
  }

  /** Get entities by type */
  getEntitiesByType(type: EntityType): CanonicalEntity[] {
    return this.getAllEntities().filter((e) => e.type === type);
  }

  /** Get a specific canonical entity */
  getEntity(id: string): CanonicalEntity | undefined {
    return this.entities.get(id);
  }

  /** Get all entity IDs appearing in a specific block */
  getEntitiesInBlock(blockId: string): CanonicalEntity[] {
    const entityIds = this.blockEntityIndex.get(blockId);
    if (!entityIds) return [];
    return Array.from(entityIds)
      .map((id) => this.entities.get(id))
      .filter((e): e is CanonicalEntity => e !== undefined);
  }

  /** Get all blocks that mention a specific entity */
  getBlocksForEntity(entityId: string): string[] {
    const entity = this.entities.get(entityId);
    return entity ? [...entity.blockIds] : [];
  }

  /** Get PII detections for a block */
  getPII(blockId: string): PIIDetection[] {
    return this.piiDetections.get(blockId) || [];
  }

  /** Check if a block contains any PII */
  hasPII(blockId: string): boolean {
    const detections = this.piiDetections.get(blockId);
    return detections !== undefined && detections.length > 0;
  }

  /** Get entity type distribution */
  getTypeDistribution(): Map<EntityType, number> {
    const dist = new Map<EntityType, number>();
    for (const entity of this.entities.values()) {
      dist.set(entity.type, (dist.get(entity.type) || 0) + 1);
    }
    return dist;
  }

  /** Get total entity count */
  get totalEntities(): number {
    return this.entities.size;
  }

  /** Get total occurrence count across all entities */
  get totalOccurrences(): number {
    let total = 0;
    for (const entity of this.entities.values()) {
      total += entity.occurrenceCount;
    }
    return total;
  }

  // ── Events ────────────────────────────────────────────────────

  /** Register a listener for entity events */
  onEvent(listener: EntityListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── Private ───────────────────────────────────────────────────

  private indexNodeEntities(blockId: string, entities: Entity[]): void {
    const blockEntityIds = new Set<string>();

    for (const entity of entities) {
      const canonicalId =
        entity.canonicalId ||
        `entity-${entity.type}-${entity.text
          .toLowerCase()
          .replace(/\s+/g, '-')}`;

      blockEntityIds.add(canonicalId);

      const existing = this.entities.get(canonicalId);
      if (existing) {
        // Update existing canonical entity
        const surfaceForms = existing.surfaceForms.includes(entity.text)
          ? existing.surfaceForms
          : [...existing.surfaceForms, entity.text];

        const blockIds = existing.blockIds.includes(blockId)
          ? existing.blockIds
          : [...existing.blockIds, blockId];

        const updated: CanonicalEntity = {
          ...existing,
          surfaceForms,
          blockIds,
          occurrenceCount: existing.occurrenceCount + 1,
          avgConfidence:
            (existing.avgConfidence * existing.occurrenceCount +
              entity.confidence) /
            (existing.occurrenceCount + 1),
        };

        this.entities.set(canonicalId, updated);
        this.emit({ type: 'entity-updated', entity: updated });
      } else {
        // New canonical entity
        const newEntity: CanonicalEntity = {
          id: canonicalId,
          type: entity.type,
          displayName: entity.text,
          surfaceForms: [entity.text],
          blockIds: [blockId],
          occurrenceCount: 1,
          avgConfidence: entity.confidence,
        };

        this.entities.set(canonicalId, newEntity);
        this.emit({ type: 'entity-added', entity: newEntity });
      }
    }

    this.blockEntityIndex.set(blockId, blockEntityIds);
  }

  private deindexBlock(blockId: string): void {
    const entityIds = this.blockEntityIndex.get(blockId);
    if (!entityIds) return;

    for (const entityId of entityIds) {
      const entity = this.entities.get(entityId);
      if (!entity) continue;

      const blockIds = entity.blockIds.filter((id) => id !== blockId);
      if (blockIds.length === 0) {
        this.entities.delete(entityId);
        this.emit({ type: 'entity-removed', entityId });
      } else {
        const updated: CanonicalEntity = {
          ...entity,
          blockIds,
          occurrenceCount: Math.max(0, entity.occurrenceCount - 1),
        };
        this.entities.set(entityId, updated);
        this.emit({ type: 'entity-updated', entity: updated });
      }
    }

    this.blockEntityIndex.delete(blockId);
  }

  private emit(event: EntityEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
