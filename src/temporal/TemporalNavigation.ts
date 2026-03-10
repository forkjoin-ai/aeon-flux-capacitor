/**
 * TemporalNavigation — Time as a first-class navigation axis
 *
 * NOBODY HAS BUILT THIS.
 *
 * Every editor treats a document as "the current version."
 * Revisions exist, but they're a safety net, not an interface.
 *
 * Time should be a navigation axis like scroll is.
 * You should be able to:
 *   - Scrub a timeline and watch meaning evolve
 *   - Ask "what did paragraph 3 say last Tuesday?"
 *   - See how sentiment shifted over the writing process
 *   - Watch the argument mature through revision
 *   - Diff not just TEXT but MEANING (embedding distance over time)
 *
 * The timeline isn't a version picker. It's a dimension of the document.
 */

// ── Types ───────────────────────────────────────────────────────────

export interface TemporalSnapshot {
  /** Snapshot ID */
  readonly id: string;
  /** Timestamp */
  readonly timestamp: string;
  /** Milliseconds since epoch (for sorting/scrubbing) */
  readonly epoch: number;
  /** Author DID who made this change */
  readonly authorDid: string;
  /** Block states at this point in time */
  readonly blockStates: Map<string, TemporalBlockState>;
  /** Document-level embedding at this moment */
  readonly documentEmbedding?: Float32Array;
  /** Document-level sentiment at this moment */
  readonly sentiment?: number;
  /** Revision label (if one was saved at this point) */
  readonly revisionLabel?: string;
}

export interface TemporalBlockState {
  /** Block text at this moment */
  readonly text: string;
  /** Block embedding at this moment */
  readonly embedding?: Float32Array;
  /** Block sentiment at this moment */
  readonly sentiment?: number;
  /** Whether this block existed at this moment */
  readonly exists: boolean;
  /** Whether this block was modified at this moment */
  readonly modified: boolean;
}

export interface TemporalDiff {
  /** The two snapshot IDs being compared */
  readonly from: string;
  readonly to: string;
  /** Time span */
  readonly duration: string;
  /** Blocks added */
  readonly added: string[];
  /** Blocks removed */
  readonly removed: string[];
  /** Blocks with text changes */
  readonly textChanged: Array<{
    blockId: string;
    from: string;
    to: string;
  }>;
  /** Blocks with meaning drift (embedding distance > threshold) */
  readonly meaningDrift: Array<{
    blockId: string;
    distance: number;
    direction: 'refined' | 'shifted' | 'reversed';
  }>;
  /** Overall sentiment shift */
  readonly sentimentShift: number;
  /** Overall document distance (embedding space) */
  readonly documentDistance: number;
}

export interface TimelineQuery {
  /** Block ID to query (null = whole document) */
  readonly blockId?: string;
  /** Start of time range */
  readonly from?: string;
  /** End of time range */
  readonly to?: string;
  /** Query type */
  readonly type: 'text' | 'sentiment' | 'embedding' | 'all';
}

export interface TemporalCurve {
  /** Timeline points */
  readonly points: Array<{
    timestamp: string;
    epoch: number;
    value: number; // normalized 0-1
    label?: string;
  }>;
  /** What this curve represents */
  readonly metric:
    | 'sentiment'
    | 'confidence'
    | 'complexity'
    | 'similarity-to-final';
  /** Block ID (null = whole document) */
  readonly blockId: string | null;
}

// ── Temporal Navigation Engine ──────────────────────────────────────

export class TemporalNavigation {
  private snapshots: TemporalSnapshot[] = [];
  private currentIndex = -1;
  private listeners: Set<
    (snapshot: TemporalSnapshot, index: number, total: number) => void
  > = new Set();
  private readonly maxSnapshots: number;

  constructor(maxSnapshots = 1000) {
    this.maxSnapshots = maxSnapshots;
  }

  /**
   * Record a snapshot of the document's current state.
   * Call this on every meaningful change (debounced in practice).
   */
  recordSnapshot(
    authorDid: string,
    blocks: Array<{
      id: string;
      text: string;
      embedding?: Float32Array;
      sentiment?: number;
      modified: boolean;
    }>,
    documentEmbedding?: Float32Array,
    documentSentiment?: number,
    revisionLabel?: string
  ): TemporalSnapshot {
    const blockStates = new Map<string, TemporalBlockState>();
    for (const block of blocks) {
      blockStates.set(block.id, {
        text: block.text,
        embedding: block.embedding,
        sentiment: block.sentiment,
        exists: true,
        modified: block.modified,
      });
    }

    // Mark blocks that existed before but don't exist now
    if (this.snapshots.length > 0) {
      const prev = this.snapshots[this.snapshots.length - 1];
      for (const [id] of prev.blockStates) {
        if (!blockStates.has(id)) {
          blockStates.set(id, {
            text: '',
            exists: false,
            modified: false,
          });
        }
      }
    }

    const snapshot: TemporalSnapshot = {
      id: `ts-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      epoch: Date.now(),
      authorDid,
      blockStates,
      documentEmbedding,
      sentiment: documentSentiment,
      revisionLabel,
    };

    this.snapshots.push(snapshot);

    // Trim if over capacity
    if (this.snapshots.length > this.maxSnapshots) {
      // Keep every Nth snapshot when trimming — don't lose history, compress it
      this.compressTimeline();
    }

    this.currentIndex = this.snapshots.length - 1;
    return snapshot;
  }

  /**
   * Scrub to a specific position in the timeline (0-1).
   */
  scrubTo(position: number): TemporalSnapshot | null {
    if (this.snapshots.length === 0) return null;
    const index = Math.min(
      this.snapshots.length - 1,
      Math.max(0, Math.round(position * (this.snapshots.length - 1)))
    );
    this.currentIndex = index;
    const snapshot = this.snapshots[index];
    this.notifyListeners(snapshot, index);
    return snapshot;
  }

  /**
   * Step forward one snapshot.
   */
  stepForward(): TemporalSnapshot | null {
    if (this.currentIndex >= this.snapshots.length - 1) return null;
    this.currentIndex++;
    const snapshot = this.snapshots[this.currentIndex];
    this.notifyListeners(snapshot, this.currentIndex);
    return snapshot;
  }

  /**
   * Step backward one snapshot.
   */
  stepBackward(): TemporalSnapshot | null {
    if (this.currentIndex <= 0) return null;
    this.currentIndex--;
    const snapshot = this.snapshots[this.currentIndex];
    this.notifyListeners(snapshot, this.currentIndex);
    return snapshot;
  }

  /**
   * Get the state of a specific block at a specific time.
   */
  getBlockAtTime(
    blockId: string,
    timestamp: string
  ): TemporalBlockState | null {
    const targetEpoch = new Date(timestamp).getTime();
    // Binary search for closest snapshot
    const snapshot = this.findClosestSnapshot(targetEpoch);
    if (!snapshot) return null;
    return snapshot.blockStates.get(blockId) ?? null;
  }

  /**
   * Compute the temporal diff between two snapshots.
   * This is a MEANING diff, not just a text diff.
   */
  diffSnapshots(fromId: string, toId: string): TemporalDiff | null {
    const from = this.snapshots.find((s) => s.id === fromId);
    const to = this.snapshots.find((s) => s.id === toId);
    if (!from || !to) return null;

    const added: string[] = [];
    const removed: string[] = [];
    const textChanged: TemporalDiff['textChanged'] = [];
    const meaningDrift: TemporalDiff['meaningDrift'] = [];

    // Find added blocks (in `to` but not `from`)
    for (const [id, state] of to.blockStates) {
      if (state.exists && !from.blockStates.has(id)) {
        added.push(id);
      }
    }

    // Find removed blocks (in `from` but not `to`)
    for (const [id, state] of from.blockStates) {
      if (state.exists) {
        const toState = to.blockStates.get(id);
        if (!toState || !toState.exists) {
          removed.push(id);
        }
      }
    }

    // Find text changes and meaning drift
    for (const [id, fromState] of from.blockStates) {
      if (!fromState.exists) continue;
      const toState = to.blockStates.get(id);
      if (!toState || !toState.exists) continue;

      if (fromState.text !== toState.text) {
        textChanged.push({
          blockId: id,
          from: fromState.text,
          to: toState.text,
        });
      }

      if (fromState.embedding && toState.embedding) {
        const distance = this.embeddingDistance(
          fromState.embedding,
          toState.embedding
        );
        if (distance > 0.1) {
          let direction: 'refined' | 'shifted' | 'reversed' = 'shifted';
          if (distance < 0.3) direction = 'refined';
          else if (distance > 0.7) direction = 'reversed';

          meaningDrift.push({ blockId: id, distance, direction });
        }
      }
    }

    // Document-level changes
    const sentimentShift = (to.sentiment ?? 0) - (from.sentiment ?? 0);
    const documentDistance =
      from.documentEmbedding && to.documentEmbedding
        ? this.embeddingDistance(from.documentEmbedding, to.documentEmbedding)
        : 0;

    const durationMs = to.epoch - from.epoch;
    const duration = this.formatDuration(durationMs);

    return {
      from: fromId,
      to: toId,
      duration,
      added,
      removed,
      textChanged,
      meaningDrift,
      sentimentShift,
      documentDistance,
    };
  }

  /**
   * Generate a temporal curve for a metric over time.
   */
  getCurve(metric: TemporalCurve['metric'], blockId?: string): TemporalCurve {
    const points: TemporalCurve['points'] = [];
    const finalSnapshot = this.snapshots[this.snapshots.length - 1];

    for (const snapshot of this.snapshots) {
      let value = 0;

      if (blockId) {
        const blockState = snapshot.blockStates.get(blockId);
        if (!blockState || !blockState.exists) continue;

        switch (metric) {
          case 'sentiment':
            value = (blockState.sentiment ?? 0 + 1) / 2; // normalize -1..1 to 0..1
            break;
          case 'confidence':
            value = blockState.embedding ? 1 : 0; // simplified
            break;
          case 'complexity':
            value = Math.min(1, blockState.text.split(/\s+/).length / 200);
            break;
          case 'similarity-to-final': {
            const finalState = finalSnapshot?.blockStates.get(blockId);
            if (blockState.embedding && finalState?.embedding) {
              value =
                1 -
                this.embeddingDistance(
                  blockState.embedding,
                  finalState.embedding
                );
            }
            break;
          }
        }
      } else {
        switch (metric) {
          case 'sentiment':
            value = (snapshot.sentiment ?? 0 + 1) / 2;
            break;
          case 'similarity-to-final':
            if (
              snapshot.documentEmbedding &&
              finalSnapshot?.documentEmbedding
            ) {
              value =
                1 -
                this.embeddingDistance(
                  snapshot.documentEmbedding,
                  finalSnapshot.documentEmbedding
                );
            }
            break;
          case 'complexity': {
            let totalWords = 0;
            for (const [, state] of snapshot.blockStates) {
              if (state.exists) totalWords += state.text.split(/\s+/).length;
            }
            value = Math.min(1, totalWords / 5000);
            break;
          }
          default:
            value = 0;
        }
      }

      points.push({
        timestamp: snapshot.timestamp,
        epoch: snapshot.epoch,
        value,
        label: snapshot.revisionLabel,
      });
    }

    return { points, metric, blockId: blockId ?? null };
  }

  /**
   * Get all snapshots (for timeline UI).
   */
  getTimeline(): Array<{
    id: string;
    timestamp: string;
    authorDid: string;
    label?: string;
    blocksModified: number;
  }> {
    return this.snapshots.map((s) => ({
      id: s.id,
      timestamp: s.timestamp,
      authorDid: s.authorDid,
      label: s.revisionLabel,
      blocksModified: Array.from(s.blockStates.values()).filter(
        (b) => b.modified
      ).length,
    }));
  }

  /**
   * Get current position in timeline.
   */
  getPosition(): { index: number; total: number; progress: number } {
    return {
      index: this.currentIndex,
      total: this.snapshots.length,
      progress:
        this.snapshots.length > 1
          ? this.currentIndex / (this.snapshots.length - 1)
          : 0,
    };
  }

  /**
   * Listen for timeline scrub events.
   */
  onScrub(
    listener: (snapshot: TemporalSnapshot, index: number, total: number) => void
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── Private ───────────────────────────────────────────────────

  private findClosestSnapshot(epoch: number): TemporalSnapshot | null {
    if (this.snapshots.length === 0) return null;

    let lo = 0,
      hi = this.snapshots.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.snapshots[mid].epoch < epoch) lo = mid + 1;
      else hi = mid;
    }

    // Check neighbors for closest
    if (lo > 0) {
      const dPrev = Math.abs(this.snapshots[lo - 1].epoch - epoch);
      const dCurr = Math.abs(this.snapshots[lo].epoch - epoch);
      if (dPrev < dCurr) return this.snapshots[lo - 1];
    }
    return this.snapshots[lo];
  }

  private embeddingDistance(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 1;
    let dot = 0,
      magA = 0,
      magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    const similarity = denom === 0 ? 0 : dot / denom;
    return 1 - similarity; // distance = 1 - cosine similarity
  }

  private compressTimeline(): void {
    // Keep: first, last, labeled, and every Nth
    const keep = Math.floor(this.maxSnapshots * 0.7);
    const step = Math.max(2, Math.floor(this.snapshots.length / keep));
    const compressed: TemporalSnapshot[] = [];

    for (let i = 0; i < this.snapshots.length; i++) {
      const isFirst = i === 0;
      const isLast = i === this.snapshots.length - 1;
      const isLabeled = !!this.snapshots[i].revisionLabel;
      const isNth = i % step === 0;

      if (isFirst || isLast || isLabeled || isNth) {
        compressed.push(this.snapshots[i]);
      }
    }

    this.snapshots = compressed;
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }

  private notifyListeners(snapshot: TemporalSnapshot, index: number): void {
    for (const listener of this.listeners) {
      listener(snapshot, index, this.snapshots.length);
    }
  }
}
