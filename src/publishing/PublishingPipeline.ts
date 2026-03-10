/**
 * PublishingPipeline — Draft → Review → Publish
 *
 * Medium understood that writing IS publishing.
 * Ghost made publishing programmable.
 * We make publishing a projection:
 *
 *   Embedding space → text projection → publishing surface
 *
 * A document's lifecycle: Draft → Review → Published → Archived.
 * Publishing emits the document as any projection: HTML page,
 * newsletter email, RSS feed, API endpoint, PDF.
 *
 * Each publish is a signed CRDT snapshot — provenance baked in.
 */

// ── Types ───────────────────────────────────────────────────────────

export type PublishState =
  | 'draft'
  | 'review'
  | 'scheduled'
  | 'published'
  | 'archived';

export interface PublishRecord {
  /** Unique publish ID */
  readonly id: string;
  /** Current state */
  state: PublishState;
  /** Canonical URL */
  readonly canonicalUrl?: string;
  /** Slug (derived from title embedding, stable) */
  readonly slug: string;
  /** Title */
  readonly title: string;
  /** Excerpt (auto-generated from first block or summary) */
  readonly excerpt: string;
  /** Cover image */
  readonly coverImage?: string;
  /** Author DID */
  readonly authorDid: string;
  /** Co-author DIDs */
  readonly coAuthors: string[];
  /** Tags (derived from entity extraction + manual) */
  readonly tags: string[];
  /** SEO metadata */
  readonly seo: SEOMetadata;
  /** Social cards */
  readonly socialCards: SocialCards;
  /** CRDT snapshot at time of publish */
  readonly snapshotId: string;
  /** Revision ID at publish time */
  readonly revisionId: string;
  /** Timestamps */
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt?: string;
  readonly scheduledFor?: string;
  /** Content hash for provenance */
  readonly contentHash: string;
  /** UCAN signature for attestation */
  readonly signature?: string;
  /** Enabled output projections */
  readonly projections: PublishProjection[];
}

export interface SEOMetadata {
  readonly title: string;
  readonly description: string;
  readonly canonicalUrl?: string;
  readonly ogImage?: string;
  readonly keywords: string[];
  readonly noIndex?: boolean;
  readonly structuredData?: Record<string, unknown>;
}

export interface SocialCards {
  readonly twitter: {
    card: 'summary' | 'summary_large_image';
    title: string;
    description: string;
    image?: string;
  };
  readonly openGraph: {
    title: string;
    description: string;
    image?: string;
    type: 'article' | 'website';
  };
}

export type PublishProjection =
  | { type: 'html'; template?: string }
  | { type: 'email'; subject: string; list?: string }
  | { type: 'rss' }
  | { type: 'api'; endpoint: string }
  | { type: 'pdf'; paperSize?: string }
  | { type: 'epub' }
  | { type: 'json-feed' }
  | { type: 'audio'; voiceModelId?: string };

// ── Publishing Pipeline ─────────────────────────────────────────────

export class PublishingPipeline {
  private records: Map<string, PublishRecord> = new Map();
  private listeners: Set<(record: PublishRecord) => void> = new Set();
  private readonly generateId: () => string;

  constructor(generateId: () => string) {
    this.generateId = generateId;
  }

  /**
   * Create a new publish record from a document.
   */
  createDraft(params: {
    title: string;
    excerpt?: string;
    authorDid: string;
    slug?: string;
    snapshotId: string;
    revisionId: string;
    tags?: string[];
    coverImage?: string;
  }): PublishRecord {
    const slug = params.slug || this.generateSlug(params.title);
    const excerpt = params.excerpt || '';

    const record: PublishRecord = {
      id: this.generateId(),
      state: 'draft',
      slug,
      title: params.title,
      excerpt,
      coverImage: params.coverImage,
      authorDid: params.authorDid,
      coAuthors: [],
      tags: params.tags || [],
      seo: this.generateSEO(params.title, excerpt),
      socialCards: this.generateSocialCards(
        params.title,
        excerpt,
        params.coverImage
      ),
      snapshotId: params.snapshotId,
      revisionId: params.revisionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      contentHash: '', // computed at publish time
      projections: [{ type: 'html' }],
    };

    this.records.set(record.id, record);
    return record;
  }

  /**
   * Transition a record through the publish lifecycle.
   */
  transition(
    recordId: string,
    to: PublishState,
    options?: {
      scheduledFor?: string;
      contentHash?: string;
      signature?: string;
    }
  ): PublishRecord | null {
    const record = this.records.get(recordId);
    if (!record) return null;

    // Validate transitions
    const validTransitions: Record<PublishState, PublishState[]> = {
      draft: ['review', 'scheduled', 'published'],
      review: ['draft', 'published', 'scheduled'],
      scheduled: ['draft', 'published'],
      published: ['archived', 'draft'],
      archived: ['draft'],
    };

    if (!validTransitions[record.state].includes(to)) {
      throw new Error(`Cannot transition from ${record.state} to ${to}`);
    }

    const updated: PublishRecord = {
      ...record,
      state: to,
      updatedAt: new Date().toISOString(),
      publishedAt:
        to === 'published' ? new Date().toISOString() : record.publishedAt,
      scheduledFor: options?.scheduledFor || record.scheduledFor,
      contentHash: options?.contentHash || record.contentHash,
      signature: options?.signature || record.signature,
    };

    this.records.set(recordId, updated);
    this.notify(updated);
    return updated;
  }

  /**
   * Set the output projections for a record.
   */
  setProjections(recordId: string, projections: PublishProjection[]): void {
    const record = this.records.get(recordId);
    if (!record) return;

    const updated = {
      ...record,
      projections,
      updatedAt: new Date().toISOString(),
    };
    this.records.set(recordId, updated);
  }

  /**
   * Update SEO metadata.
   */
  updateSEO(recordId: string, seo: Partial<SEOMetadata>): void {
    const record = this.records.get(recordId);
    if (!record) return;

    const updated = {
      ...record,
      seo: { ...record.seo, ...seo },
      updatedAt: new Date().toISOString(),
    };
    this.records.set(recordId, updated);
  }

  /**
   * Get a publish record.
   */
  getRecord(id: string): PublishRecord | undefined {
    return this.records.get(id);
  }

  /**
   * List records by state.
   */
  listByState(state: PublishState): PublishRecord[] {
    return Array.from(this.records.values()).filter((r) => r.state === state);
  }

  /**
   * Listen for publish events.
   */
  onPublish(listener: (record: PublishRecord) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Estimated reading time */
  estimateReadingTime(wordCount: number): {
    minutes: number;
    label: string;
  } {
    const wpm = 238; // Medium's reading speed
    const minutes = Math.max(1, Math.ceil(wordCount / wpm));
    return {
      minutes,
      label: minutes === 1 ? '1 min read' : `${minutes} min read`,
    };
  }

  // ── Private ───────────────────────────────────────────────────

  private generateSlug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 60);
  }

  private generateSEO(title: string, excerpt: string): SEOMetadata {
    return {
      title: title.slice(0, 60),
      description: excerpt.slice(0, 155),
      keywords: [],
    };
  }

  private generateSocialCards(
    title: string,
    excerpt: string,
    image?: string
  ): SocialCards {
    return {
      twitter: {
        card: image ? 'summary_large_image' : 'summary',
        title: title.slice(0, 70),
        description: excerpt.slice(0, 200),
        image,
      },
      openGraph: {
        title: title.slice(0, 90),
        description: excerpt.slice(0, 300),
        image,
        type: 'article',
      },
    };
  }

  private notify(record: PublishRecord): void {
    for (const listener of this.listeners) {
      listener(record);
    }
  }
}
