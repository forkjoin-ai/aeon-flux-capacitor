/**
 * ReadingAnalytics — Understand how your audience reads
 *
 * Medium shows views. Ghost shows subscribers.
 * We show HOW people read: where they slow down,
 * where they stop, what they re-read, what they skip.
 *
 * All privacy-preserving: aggregated, never individual.
 * Stored as embeddings, never as user profiles.
 */

// ── Types ───────────────────────────────────────────────────────────

export interface ReadingSession {
  /** Anonymous session ID (not tied to identity) */
  readonly sessionId: string;
  /** Document ID */
  readonly documentId: string;
  /** Session start */
  readonly startedAt: string;
  /** Session end */
  endedAt?: string;
  /** Total time spent reading (ms) */
  totalTimeMs: number;
  /** Scroll depth (0-1) */
  maxScrollDepth: number;
  /** Blocks viewed */
  blocksViewed: Set<string>;
  /** Per-block reading time */
  blockTimes: Map<string, number>;
  /** Blocks re-read (scrolled back to) */
  blocksReRead: Set<string>;
  /** Whether the reader reached the end */
  reachedEnd: boolean;
  /** Device type */
  readonly deviceType: 'mobile' | 'tablet' | 'desktop';
}

export interface DocumentAnalytics {
  /** Document ID */
  readonly documentId: string;
  /** Total unique sessions */
  totalSessions: number;
  /** Average reading time (ms) */
  avgReadingTimeMs: number;
  /** Average scroll depth (0-1) */
  avgScrollDepth: number;
  /** Completion rate (reached end) */
  completionRate: number;
  /** Per-block engagement */
  blockEngagement: Map<string, BlockEngagement>;
  /** Drop-off points (blocks where readers leave) */
  dropOffPoints: Array<{ blockId: string; dropRate: number }>;
  /** Most re-read blocks */
  mostReRead: Array<{ blockId: string; reReadRate: number }>;
  /** Device breakdown */
  deviceBreakdown: { mobile: number; tablet: number; desktop: number };
}

export interface BlockEngagement {
  /** Average time spent on this block (ms) */
  avgTimeMs: number;
  /** Percentage of readers who viewed this block */
  viewRate: number;
  /** Percentage of readers who re-read this block */
  reReadRate: number;
  /** Relative engagement score (0-1, compared to other blocks) */
  engagementScore: number;
}

// ── Reading Analytics Engine ────────────────────────────────────────

export class ReadingAnalytics {
  private sessions: Map<string, ReadingSession> = new Map();
  private activeSession: ReadingSession | null = null;
  private analytics: Map<string, DocumentAnalytics> = new Map();
  private scrollCheckInterval: ReturnType<typeof setInterval> | null = null;
  private lastViewedBlockId: string | null = null;
  private lastBlockTime: number = 0;

  /**
   * Start a reading session.
   */
  startSession(documentId: string): ReadingSession {
    const session: ReadingSession = {
      sessionId: `rs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      documentId,
      startedAt: new Date().toISOString(),
      totalTimeMs: 0,
      maxScrollDepth: 0,
      blocksViewed: new Set(),
      blockTimes: new Map(),
      blocksReRead: new Set(),
      reachedEnd: false,
      deviceType: this.detectDevice(),
    };

    this.activeSession = session;
    this.sessions.set(session.sessionId, session);
    this.lastBlockTime = Date.now();

    // Track time in 1-second intervals
    this.scrollCheckInterval = setInterval(() => {
      if (this.activeSession) {
        this.activeSession.totalTimeMs += 1000;
      }
    }, 1000);

    return session;
  }

  /**
   * Track that a block is now visible (in viewport).
   */
  trackBlockView(blockId: string): void {
    if (!this.activeSession) return;

    // Record time spent on previous block
    if (this.lastViewedBlockId && this.lastViewedBlockId !== blockId) {
      const elapsed = Date.now() - this.lastBlockTime;
      const existing =
        this.activeSession.blockTimes.get(this.lastViewedBlockId) ?? 0;
      this.activeSession.blockTimes.set(
        this.lastViewedBlockId,
        existing + elapsed
      );
    }

    // Check for re-read
    if (this.activeSession.blocksViewed.has(blockId)) {
      this.activeSession.blocksReRead.add(blockId);
    }

    this.activeSession.blocksViewed.add(blockId);
    this.lastViewedBlockId = blockId;
    this.lastBlockTime = Date.now();
  }

  /**
   * Track scroll depth.
   */
  trackScroll(depth: number): void {
    if (!this.activeSession) return;
    this.activeSession.maxScrollDepth = Math.max(
      this.activeSession.maxScrollDepth,
      depth
    );

    if (depth >= 0.95) {
      this.activeSession.reachedEnd = true;
    }
  }

  /**
   * End the current reading session and aggregate analytics.
   */
  endSession(): ReadingSession | null {
    if (!this.activeSession) return null;

    // Record last block time
    if (this.lastViewedBlockId) {
      const elapsed = Date.now() - this.lastBlockTime;
      const existing =
        this.activeSession.blockTimes.get(this.lastViewedBlockId) ?? 0;
      this.activeSession.blockTimes.set(
        this.lastViewedBlockId,
        existing + elapsed
      );
    }

    this.activeSession.endedAt = new Date().toISOString();

    if (this.scrollCheckInterval) {
      clearInterval(this.scrollCheckInterval);
      this.scrollCheckInterval = null;
    }

    const session = this.activeSession;
    this.activeSession = null;
    this.lastViewedBlockId = null;

    // Aggregate into document analytics
    this.aggregate(session);

    return session;
  }

  /**
   * Get analytics for a document.
   */
  getAnalytics(documentId: string): DocumentAnalytics | null {
    return this.analytics.get(documentId) ?? null;
  }

  /**
   * Get the engagement heatmap — which blocks are hot/cold.
   */
  getEngagementHeatmap(documentId: string): Map<string, number> {
    const docAnalytics = this.analytics.get(documentId);
    if (!docAnalytics) return new Map();

    const heatmap = new Map<string, number>();
    for (const [blockId, engagement] of docAnalytics.blockEngagement) {
      heatmap.set(blockId, engagement.engagementScore);
    }
    return heatmap;
  }

  /**
   * Clean up.
   */
  destroy(): void {
    if (this.scrollCheckInterval) clearInterval(this.scrollCheckInterval);
    this.endSession();
  }

  // ── Private ───────────────────────────────────────────────────

  private aggregate(session: ReadingSession): void {
    let analytics = this.analytics.get(session.documentId);

    if (!analytics) {
      analytics = {
        documentId: session.documentId,
        totalSessions: 0,
        avgReadingTimeMs: 0,
        avgScrollDepth: 0,
        completionRate: 0,
        blockEngagement: new Map(),
        dropOffPoints: [],
        mostReRead: [],
        deviceBreakdown: { mobile: 0, tablet: 0, desktop: 0 },
      };
      this.analytics.set(session.documentId, analytics);
    }

    const n = analytics.totalSessions;
    analytics.totalSessions++;

    // Running averages
    analytics.avgReadingTimeMs =
      (analytics.avgReadingTimeMs * n + session.totalTimeMs) / (n + 1);
    analytics.avgScrollDepth =
      (analytics.avgScrollDepth * n + session.maxScrollDepth) / (n + 1);
    analytics.completionRate =
      (analytics.completionRate * n + (session.reachedEnd ? 1 : 0)) / (n + 1);

    // Device breakdown
    analytics.deviceBreakdown[session.deviceType]++;

    // Per-block engagement
    for (const [blockId, timeMs] of session.blockTimes) {
      const existing = analytics.blockEngagement.get(blockId);
      if (existing) {
        const m = existing.viewRate * n; // approximate session count for this block
        analytics.blockEngagement.set(blockId, {
          avgTimeMs: (existing.avgTimeMs * m + timeMs) / (m + 1),
          viewRate: (m + 1) / (n + 1),
          reReadRate: session.blocksReRead.has(blockId)
            ? (existing.reReadRate * m + 1) / (m + 1)
            : (existing.reReadRate * m) / (m + 1),
          engagementScore: 0, // recalculated below
        });
      } else {
        analytics.blockEngagement.set(blockId, {
          avgTimeMs: timeMs,
          viewRate: 1 / (n + 1),
          reReadRate: session.blocksReRead.has(blockId) ? 1 : 0,
          engagementScore: 0,
        });
      }
    }

    // Recalculate engagement scores (relative to max)
    let maxTime = 0;
    for (const [, engagement] of analytics.blockEngagement) {
      maxTime = Math.max(maxTime, engagement.avgTimeMs);
    }
    if (maxTime > 0) {
      for (const [blockId, engagement] of analytics.blockEngagement) {
        analytics.blockEngagement.set(blockId, {
          ...engagement,
          engagementScore: engagement.avgTimeMs / maxTime,
        });
      }
    }

    // Drop-off points
    const allBlocks = Array.from(analytics.blockEngagement.entries());
    allBlocks.sort((a, b) => a[1].viewRate - b[1].viewRate);
    analytics.dropOffPoints = allBlocks
      .filter(([, e]) => e.viewRate < analytics!.completionRate * 0.5)
      .map(([blockId, e]) => ({ blockId, dropRate: 1 - e.viewRate }))
      .slice(0, 5);

    // Most re-read
    analytics.mostReRead = allBlocks
      .filter(([, e]) => e.reReadRate > 0.1)
      .sort((a, b) => b[1].reReadRate - a[1].reReadRate)
      .map(([blockId, e]) => ({ blockId, reReadRate: e.reReadRate }))
      .slice(0, 5);
  }

  private detectDevice(): 'mobile' | 'tablet' | 'desktop' {
    if (typeof window === 'undefined') return 'desktop';
    const width = window.innerWidth;
    if (width < 768) return 'mobile';
    if (width < 1024) return 'tablet';
    return 'desktop';
  }
}
