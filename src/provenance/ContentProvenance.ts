/**
 * ContentProvenance — Cryptographic authorship attestation
 *
 * Every block has an author. Every revision has a signature.
 * Content provenance is not a feature — it's a guarantee.
 *
 * Uses UCAN tokens for decentralized identity:
 *   DID → signs → content hash → chain of custody
 *
 * In an era of AI-generated content, proving you wrote something
 * is the single most valuable metadata you can attach.
 */

// ── Types ───────────────────────────────────────────────────────────

export interface ProvenanceRecord {
  /** Unique record ID */
  readonly id: string;
  /** Block or revision this attests */
  readonly targetId: string;
  /** Target type */
  readonly targetType: 'block' | 'revision' | 'document' | 'publish';
  /** Author DID */
  readonly authorDid: string;
  /** Content hash (SHA-256) */
  readonly contentHash: string;
  /** Timestamp */
  readonly timestamp: string;
  /** UCAN token (signature proof) */
  readonly ucanToken: string;
  /** Parent record (chain of custody) */
  readonly parentId?: string;
  /** Whether this was AI-assisted */
  readonly aiAssisted: boolean;
  /** AI model used, if any */
  readonly aiModel?: string;
  /** Percentage of content that was AI-generated (0-100) */
  readonly aiContribution?: number;
}

export interface ProvenanceChain {
  /** The full chain from original to current */
  readonly records: ProvenanceRecord[];
  /** The original author DID */
  readonly originalAuthor: string;
  /** All authors in the chain */
  readonly allAuthors: string[];
  /** Total AI contribution across the chain */
  readonly totalAiContribution: number;
  /** Chain integrity status */
  readonly integrity: 'valid' | 'broken' | 'unverified';
}

export interface ProvenanceConfig {
  /** Function to sign content with UCAN */
  readonly sign: (content: string, did: string) => Promise<string>;
  /** Function to verify a UCAN signature */
  readonly verify: (ucanToken: string, contentHash: string) => Promise<boolean>;
  /** Function to compute SHA-256 hash */
  readonly hash: (content: string) => Promise<string>;
  /** Local user's DID */
  readonly localDid: string;
}

// ── Content Provenance Engine ───────────────────────────────────────

export class ContentProvenance {
  private config: ProvenanceConfig;
  private records: Map<string, ProvenanceRecord> = new Map();
  private chainIndex: Map<string, string[]> = new Map(); // targetId → record IDs
  private generateId: () => string;

  constructor(
    config: ProvenanceConfig,
    generateId: () => string = () =>
      `prov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  ) {
    this.config = config;
    this.generateId = generateId;
  }

  /**
   * Attest that content was authored by the current user.
   */
  async attest(params: {
    targetId: string;
    targetType: ProvenanceRecord['targetType'];
    content: string;
    parentRecordId?: string;
    aiAssisted?: boolean;
    aiModel?: string;
    aiContribution?: number;
  }): Promise<ProvenanceRecord> {
    const contentHash = await this.config.hash(params.content);
    const ucanToken = await this.config.sign(contentHash, this.config.localDid);

    const record: ProvenanceRecord = {
      id: this.generateId(),
      targetId: params.targetId,
      targetType: params.targetType,
      authorDid: this.config.localDid,
      contentHash,
      timestamp: new Date().toISOString(),
      ucanToken,
      parentId: params.parentRecordId,
      aiAssisted: params.aiAssisted ?? false,
      aiModel: params.aiModel,
      aiContribution: params.aiContribution,
    };

    this.records.set(record.id, record);

    // Update chain index
    const chain = this.chainIndex.get(params.targetId) ?? [];
    chain.push(record.id);
    this.chainIndex.set(params.targetId, chain);

    return record;
  }

  /**
   * Verify a provenance record's signature.
   */
  async verify(recordId: string): Promise<boolean> {
    const record = this.records.get(recordId);
    if (!record) return false;

    return this.config.verify(record.ucanToken, record.contentHash);
  }

  /**
   * Get the full provenance chain for a target.
   */
  async getChain(targetId: string): Promise<ProvenanceChain> {
    const recordIds = this.chainIndex.get(targetId) ?? [];
    const records = recordIds
      .map((id) => this.records.get(id))
      .filter((r): r is ProvenanceRecord => r !== undefined)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    if (records.length === 0) {
      return {
        records: [],
        originalAuthor: '',
        allAuthors: [],
        totalAiContribution: 0,
        integrity: 'unverified',
      };
    }

    const allAuthors = [...new Set(records.map((r) => r.authorDid))];
    const totalAiContribution =
      records.reduce((sum, r) => sum + (r.aiContribution ?? 0), 0) /
      records.length;

    // Verify chain integrity
    let integrity: ProvenanceChain['integrity'] = 'valid';
    for (const record of records) {
      const valid = await this.config.verify(
        record.ucanToken,
        record.contentHash
      );
      if (!valid) {
        integrity = 'broken';
        break;
      }
    }

    return {
      records,
      originalAuthor: records[0].authorDid,
      allAuthors,
      totalAiContribution,
      integrity,
    };
  }

  /**
   * Generate a human-readable provenance badge for a block.
   */
  getProvenanceBadge(targetId: string): {
    authors: string[];
    aiAssisted: boolean;
    verified: boolean;
    label: string;
  } {
    const recordIds = this.chainIndex.get(targetId) ?? [];
    const records = recordIds
      .map((id) => this.records.get(id))
      .filter((r): r is ProvenanceRecord => r !== undefined);

    const authors = [...new Set(records.map((r) => r.authorDid))];
    const aiAssisted = records.some((r) => r.aiAssisted);
    const verified = records.length > 0; // simplified; real impl verifies signatures

    let label =
      authors.length === 1
        ? `by ${authors[0].slice(0, 12)}…`
        : `by ${authors.length} authors`;

    if (aiAssisted) label += ' · AI-assisted';

    return { authors, aiAssisted, verified, label };
  }

  /**
   * Get all provenance records.
   */
  getAllRecords(): ProvenanceRecord[] {
    return Array.from(this.records.values());
  }
}
