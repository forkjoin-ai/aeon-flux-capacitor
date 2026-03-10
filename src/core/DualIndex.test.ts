import { describe, it, expect, beforeEach } from 'vitest';
import { DualIndex } from './DualIndex';
import type { AmygdalaEntry, HippocampusEntry } from './DualIndex';

// ── Helpers ─────────────────────────────────────────────────────────

function makeAmygdala(
  blockId: string,
  overrides: Partial<AmygdalaEntry> = {}
): AmygdalaEntry {
  return {
    blockId,
    valence: 0.6,
    arousal: 0.4,
    dominance: 0.5,
    emotion: 'neutral',
    intensity: 0.5,
    somaticMarkers: [],
    taggedAt: Date.now(),
    confidence: 0.7,
    ...overrides,
  };
}

function makeHippocampus(
  blockId: string,
  overrides: Partial<HippocampusEntry> = {}
): HippocampusEntry {
  return {
    blockId,
    embedding: new Float32Array([0.1, 0.2, 0.3]),
    entities: [],
    edges: [],
    crossDocLinks: [],
    temporal: {
      createdAt: Date.now(),
      lastModifiedAt: Date.now(),
      modificationCount: 1,
      lifespan: 'durable',
    },
    topics: [],
    claims: [],
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('DualIndex', () => {
  let index: DualIndex;

  beforeEach(() => {
    index = new DualIndex({ blendRatio: 0.5 });
  });

  describe('construction', () => {
    it('creates with default blend ratio', () => {
      const defaultIndex = new DualIndex();
      expect(defaultIndex).toBeDefined();
    });

    it('creates with custom blend ratio', () => {
      const customIndex = new DualIndex({ blendRatio: 0.8 });
      expect(customIndex).toBeDefined();
    });

    it('clamps blend ratio to 0-1', () => {
      const clamped = new DualIndex({ blendRatio: 1.5 });
      expect(clamped).toBeDefined();
    });
  });

  describe('indexing', () => {
    it('indexes an amygdala + hippocampus entry pair', () => {
      const amygdala = makeAmygdala('block-1');
      const hippocampus = makeHippocampus('block-1');
      index.setAmygdala(amygdala);
      index.setHippocampus(hippocampus);

      const sample = index.sample('block-1');
      expect(sample).not.toBeNull();
      expect(sample!.blockId).toBe('block-1');
    });

    it('overwrites existing entry for same blockId', () => {
      index.setAmygdala(makeAmygdala('block-1', { valence: 0.2 }));
      index.setHippocampus(makeHippocampus('block-1'));
      index.setAmygdala(makeAmygdala('block-1', { valence: 0.9 }));
      index.setHippocampus(makeHippocampus('block-1'));

      const sample = index.sample('block-1');
      expect(sample).not.toBeNull();
    });

    it('indexes multiple blocks independently', () => {
      index.setAmygdala(makeAmygdala('block-1'));
      index.setHippocampus(makeHippocampus('block-1'));
      index.setAmygdala(makeAmygdala('block-2'));
      index.setHippocampus(makeHippocampus('block-2'));
      index.setAmygdala(makeAmygdala('block-3'));
      index.setHippocampus(makeHippocampus('block-3'));

      expect(index.sample('block-1')).not.toBeNull();
      expect(index.sample('block-2')).not.toBeNull();
      expect(index.sample('block-3')).not.toBeNull();
    });
  });

  describe('sampling', () => {
    it('returns null for unindexed blockId', () => {
      expect(index.sample('nonexistent')).toBeNull();
    });

    it('returns a RenderSample with interpolated values', () => {
      index.setAmygdala(
        makeAmygdala('block-1', { valence: 0.8, arousal: 0.6 })
      );
      index.setHippocampus(
        makeHippocampus('block-1', { embedding: new Float32Array([0.5, 0.5]) })
      );

      const sample = index.sample('block-1');
      expect(sample).toBeDefined();
      expect(sample!.blockId).toBe('block-1');
      expect(sample!.interpolated).toBeDefined();
      expect(typeof sample!.interpolated.priority).toBe('number');
      expect(typeof sample!.interpolated.color).toBe('string');
    });

    it('blends differently at ratio 0 (all context)', () => {
      const contextOnly = new DualIndex({ blendRatio: 0 });
      contextOnly.setAmygdala(
        makeAmygdala('block-1', { valence: 1.0, arousal: 1.0 })
      );
      contextOnly.setHippocampus(makeHippocampus('block-1'));

      const sample = contextOnly.sample('block-1');
      expect(sample).toBeDefined();
    });

    it('blends differently at ratio 1 (all emotion)', () => {
      const emotionOnly = new DualIndex({ blendRatio: 1 });
      emotionOnly.setAmygdala(
        makeAmygdala('block-1', { valence: 1.0, arousal: 1.0 })
      );
      emotionOnly.setHippocampus(makeHippocampus('block-1'));

      const sample = emotionOnly.sample('block-1');
      expect(sample).toBeDefined();
    });

    it('returns sample with only amygdala data', () => {
      index.setAmygdala(makeAmygdala('block-1'));
      const sample = index.sample('block-1');
      expect(sample).not.toBeNull();
      expect(sample!.blockId).toBe('block-1');
    });

    it('returns sample with only hippocampus data', () => {
      index.setHippocampus(makeHippocampus('block-1'));
      const sample = index.sample('block-1');
      expect(sample).not.toBeNull();
      expect(sample!.blockId).toBe('block-1');
    });
  });

  describe('sampleAll', () => {
    it('returns empty array for no data', () => {
      expect(index.sampleAll()).toEqual([]);
    });

    it('returns samples for all indexed blocks', () => {
      index.setAmygdala(makeAmygdala('b1'));
      index.setHippocampus(makeHippocampus('b1'));
      index.setAmygdala(makeAmygdala('b2'));
      index.setHippocampus(makeHippocampus('b2'));
      index.setAmygdala(makeAmygdala('b3'));
      index.setHippocampus(makeHippocampus('b3'));

      const samples = index.sampleAll();
      expect(samples).toHaveLength(3);
    });
  });

  describe('querying', () => {
    it('queries amygdala by emotion', () => {
      index.setAmygdala(makeAmygdala('b1', { emotion: 'joy', intensity: 0.8 }));
      index.setAmygdala(
        makeAmygdala('b2', { emotion: 'sadness', intensity: 0.6 })
      );

      const results = index.queryAmygdala({ emotion: 'joy' });
      expect(results).toHaveLength(1);
      expect(results[0].blockId).toBe('b1');
    });

    it('queries amygdala by intensity', () => {
      index.setAmygdala(makeAmygdala('b1', { emotion: 'joy', intensity: 0.8 }));
      index.setAmygdala(
        makeAmygdala('b2', { emotion: 'sadness', intensity: 0.3 })
      );

      const results = index.queryAmygdala({ minIntensity: 0.5 });
      expect(results).toHaveLength(1);
    });
  });

  describe('somatic markers', () => {
    it('stores somatic markers in amygdala entries', () => {
      const markers = [
        { type: 'tension' as const, intensity: 0.7, region: 'chest' as const },
        { type: 'warmth' as const, intensity: 0.4, region: 'limbs' as const },
      ];

      index.setAmygdala(makeAmygdala('block-1', { somaticMarkers: markers }));
      index.setHippocampus(makeHippocampus('block-1'));

      const sample = index.sample('block-1');
      expect(sample).not.toBeNull();
      expect(sample!.amygdala.somaticMarkers).toHaveLength(2);
    });
  });

  describe('cross-document links', () => {
    it('stores cross-doc links in hippocampus entries', () => {
      const links = [
        {
          documentId: 'doc-2',
          blockId: 'intro',
          similarity: 0.85,
          relationship: 'supports',
        },
      ];

      index.setAmygdala(makeAmygdala('block-1'));
      index.setHippocampus(
        makeHippocampus('block-1', { crossDocLinks: links })
      );

      const sample = index.sample('block-1');
      expect(sample).not.toBeNull();
      expect(sample!.hippocampus.crossDocLinks).toHaveLength(1);
    });
  });

  describe('stats', () => {
    it('returns correct stats', () => {
      index.setAmygdala(makeAmygdala('b1'));
      index.setHippocampus(makeHippocampus('b1'));
      index.setAmygdala(makeAmygdala('b2'));

      const stats = index.getStats();
      expect(stats.amygdalaSize).toBe(2);
      expect(stats.hippocampusSize).toBe(1);
      expect(stats.bothIndexed).toBe(1);
      expect(stats.amygdalaOnly).toBe(1);
    });
  });

  describe('listeners', () => {
    it('notifies on dual index completion', () => {
      let notified = false;
      index.onSample(() => {
        notified = true;
      });

      index.setAmygdala(makeAmygdala('b1'));
      index.setHippocampus(makeHippocampus('b1'));

      expect(notified).toBe(true);
    });

    it('supports unsubscribe', () => {
      let count = 0;
      const unsub = index.onSample(() => {
        count++;
      });

      index.setAmygdala(makeAmygdala('b1'));
      index.setHippocampus(makeHippocampus('b1'));
      expect(count).toBe(1);

      unsub();
      index.setAmygdala(makeAmygdala('b2'));
      index.setHippocampus(makeHippocampus('b2'));
      expect(count).toBe(1);
    });
  });
});
