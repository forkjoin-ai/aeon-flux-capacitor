import { describe, it, expect, beforeEach } from 'vitest';
import { TemporalNavigation } from './TemporalNavigation';

// ── Helpers ─────────────────────────────────────────────────────────

function makeBlocks(count = 3, modified = true) {
  return Array.from({ length: count }, (_, i) => ({
    id: `block-${i}`,
    text: `Block ${i} content with meaningful text for testing.`,
    exists: true,
    modified,
  }));
}

// ── Tests ───────────────────────────────────────────────────────────

describe('TemporalNavigation', () => {
  let nav: TemporalNavigation;

  beforeEach(() => {
    nav = new TemporalNavigation(100);
  });

  describe('construction', () => {
    it('creates with default max snapshots', () => {
      const defaultNav = new TemporalNavigation();
      expect(defaultNav).toBeDefined();
    });

    it('creates with custom max snapshots', () => {
      expect(nav).toBeDefined();
    });
  });

  describe('snapshot recording', () => {
    it('records a snapshot', () => {
      const snapshot = nav.recordSnapshot('did:test:author1', makeBlocks());
      expect(snapshot).toBeDefined();
      expect(snapshot.id).toBeTruthy();
      expect(snapshot.authorDid).toBe('did:test:author1');
    });

    it('records multiple snapshots', () => {
      nav.recordSnapshot('did:test:1', makeBlocks());
      nav.recordSnapshot('did:test:1', makeBlocks());
      nav.recordSnapshot('did:test:1', makeBlocks());

      const position = nav.getPosition();
      expect(position.total).toBe(3);
    });

    it('records with document embedding', () => {
      const embedding = new Float32Array([0.1, 0.2, 0.3]);
      const snapshot = nav.recordSnapshot(
        'did:test:1',
        makeBlocks(),
        embedding
      );
      expect(snapshot.documentEmbedding).toBeDefined();
    });

    it('records with revision label', () => {
      const snapshot = nav.recordSnapshot(
        'did:test:1',
        makeBlocks(),
        undefined,
        undefined,
        'v1.0'
      );
      expect(snapshot.revisionLabel).toBe('v1.0');
    });

    it('records with block embeddings and sentiment', () => {
      const blocksWithEmbed = makeBlocks().map((b) => ({
        ...b,
        embedding: new Float32Array([0.1, 0.2]),
        sentiment: 0.7,
      }));
      const snapshot = nav.recordSnapshot('did:test:1', blocksWithEmbed);
      expect(snapshot.blockStates.size).toBe(3);
    });

    it('compresses timeline when exceeding max snapshots', () => {
      for (let i = 0; i < 105; i++) {
        nav.recordSnapshot('did:test:1', makeBlocks());
      }
      const position = nav.getPosition();
      expect(position.total).toBeLessThanOrEqual(100);
    });
  });

  describe('timeline navigation', () => {
    beforeEach(() => {
      for (let i = 0; i < 5; i++) {
        nav.recordSnapshot('did:test:1', makeBlocks());
      }
    });

    it('scrubs to a position (0-1)', () => {
      const snapshot = nav.scrubTo(0);
      expect(snapshot).not.toBeNull();
    });

    it('scrubs to midpoint', () => {
      const snapshot = nav.scrubTo(0.5);
      expect(snapshot).not.toBeNull();
    });

    it('scrubs to end', () => {
      const snapshot = nav.scrubTo(1);
      expect(snapshot).not.toBeNull();
    });

    it('returns null when scrubbing empty timeline', () => {
      const empty = new TemporalNavigation();
      expect(empty.scrubTo(0.5)).toBeNull();
    });

    it('steps forward', () => {
      nav.scrubTo(0); // go to start
      const snapshot = nav.stepForward();
      expect(snapshot).not.toBeNull();
    });

    it('returns null stepping forward past end', () => {
      nav.scrubTo(1); // go to end
      const result = nav.stepForward();
      expect(result).toBeNull();
    });

    it('steps backward', () => {
      nav.scrubTo(1); // go to end
      const snapshot = nav.stepBackward();
      expect(snapshot).not.toBeNull();
    });

    it('returns null stepping backward past start', () => {
      nav.scrubTo(0); // go to start
      const result = nav.stepBackward();
      expect(result).toBeNull();
    });
  });

  describe('block at time', () => {
    it('gets block state at a specific time', () => {
      const snap = nav.recordSnapshot('did:test:1', makeBlocks());
      const state = nav.getBlockAtTime('block-0', snap.timestamp);
      expect(state).not.toBeNull();
      expect(state!.text).toContain('Block 0');
    });

    it('returns null for nonexistent block', () => {
      nav.recordSnapshot('did:test:1', makeBlocks());
      const snap = nav.recordSnapshot('did:test:1', makeBlocks());
      const state = nav.getBlockAtTime('nonexistent', snap.timestamp);
      expect(state).toBeNull();
    });
  });

  describe('diff', () => {
    it('computes diff between two snapshots', () => {
      const s1 = nav.recordSnapshot('did:test:1', makeBlocks());
      const blocks2 = makeBlocks();
      blocks2[0].text = 'Updated block 0 text';
      const s2 = nav.recordSnapshot('did:test:1', blocks2);

      const diff = nav.diffSnapshots(s1.id, s2.id);
      expect(diff).not.toBeNull();
      expect(diff!.from).toBe(s1.id);
      expect(diff!.to).toBe(s2.id);
    });

    it('returns null for nonexistent snapshot ids', () => {
      expect(nav.diffSnapshots('fake1', 'fake2')).toBeNull();
    });

    it('detects text changes', () => {
      const s1 = nav.recordSnapshot('did:test:1', makeBlocks());
      const blocks2 = makeBlocks();
      blocks2[1].text = 'Completely different content here.';
      const s2 = nav.recordSnapshot('did:test:1', blocks2);

      const diff = nav.diffSnapshots(s1.id, s2.id);
      expect(diff!.textChanged.length).toBeGreaterThan(0);
    });

    it('detects added blocks', () => {
      const s1 = nav.recordSnapshot('did:test:1', makeBlocks(2));
      const s2 = nav.recordSnapshot('did:test:1', makeBlocks(4));

      const diff = nav.diffSnapshots(s1.id, s2.id);
      expect(diff!.added.length).toBeGreaterThan(0);
    });

    it('detects removed blocks', () => {
      const s1 = nav.recordSnapshot('did:test:1', makeBlocks(4));
      const s2 = nav.recordSnapshot('did:test:1', makeBlocks(2));

      const diff = nav.diffSnapshots(s1.id, s2.id);
      expect(diff!.removed.length).toBeGreaterThan(0);
    });

    it('computes sentiment shift', () => {
      const s1 = nav.recordSnapshot('did:test:1', makeBlocks(), undefined, 0.3);
      const s2 = nav.recordSnapshot('did:test:1', makeBlocks(), undefined, 0.8);

      const diff = nav.diffSnapshots(s1.id, s2.id);
      expect(diff!.sentimentShift).not.toBe(0);
    });
  });

  describe('curves', () => {
    beforeEach(() => {
      for (let i = 0; i < 5; i++) {
        const blocks = makeBlocks().map((b) => ({
          ...b,
          sentiment: 0.1 * (i + 1),
        }));
        nav.recordSnapshot('did:test:1', blocks, undefined, 0.2 * (i + 1));
      }
    });

    it('generates sentiment curve', () => {
      const curve = nav.getCurve('sentiment');
      expect(curve.metric).toBe('sentiment');
      expect(curve.points.length).toBeGreaterThan(0);
    });

    it('generates confidence curve', () => {
      const curve = nav.getCurve('confidence');
      expect(curve.metric).toBe('confidence');
    });

    it('generates complexity curve', () => {
      const curve = nav.getCurve('complexity');
      expect(curve.metric).toBe('complexity');
    });

    it('generates block-specific curve', () => {
      const curve = nav.getCurve('sentiment', 'block-0');
      expect(curve.blockId).toBe('block-0');
    });
  });

  describe('timeline', () => {
    it('returns empty timeline when no snapshots', () => {
      expect(nav.getTimeline()).toHaveLength(0);
    });

    it('returns timeline entries', () => {
      nav.recordSnapshot('did:test:1', makeBlocks());
      nav.recordSnapshot('did:test:2', makeBlocks());

      const timeline = nav.getTimeline();
      expect(timeline).toHaveLength(2);
      expect(timeline[0].authorDid).toBe('did:test:1');
    });
  });

  describe('position', () => {
    it('returns position info', () => {
      nav.recordSnapshot('did:test:1', makeBlocks());
      nav.recordSnapshot('did:test:1', makeBlocks());

      const pos = nav.getPosition();
      expect(pos.total).toBe(2);
      expect(pos.progress).toBeGreaterThanOrEqual(0);
      expect(pos.progress).toBeLessThanOrEqual(1);
    });
  });

  describe('events', () => {
    it('emits scrub events', () => {
      let emitted = false;
      nav.onScrub(() => {
        emitted = true;
      });

      nav.recordSnapshot('did:test:1', makeBlocks());
      nav.recordSnapshot('did:test:1', makeBlocks());
      nav.scrubTo(0);

      expect(emitted).toBe(true);
    });

    it('supports unsubscribe', () => {
      let count = 0;
      const unsub = nav.onScrub(() => {
        count++;
      });

      nav.recordSnapshot('did:test:1', makeBlocks());
      nav.recordSnapshot('did:test:1', makeBlocks());
      nav.scrubTo(0);
      expect(count).toBe(1);

      unsub();
      nav.scrubTo(1);
      expect(count).toBe(1);
    });
  });

  describe('embedding distance', () => {
    it('computes distance between embeddings', () => {
      const s1 = nav.recordSnapshot(
        'did:test:1',
        makeBlocks(),
        new Float32Array([1, 0, 0])
      );
      const s2 = nav.recordSnapshot(
        'did:test:1',
        makeBlocks(),
        new Float32Array([0, 1, 0])
      );

      const diff = nav.diffSnapshots(s1.id, s2.id);
      expect(diff!.documentDistance).toBeGreaterThan(0);
    });
  });
});
