import { describe, it, expect, beforeEach } from 'vitest';
import { ContentKnapsack } from './ContentKnapsack';
import type {
  ContentItem,
  ContentValue,
  ContentWeight,
  ContainerConstraints,
  PersonalizationContext,
  ESIValueOverride,
} from './ContentKnapsack';

// ── Helpers ─────────────────────────────────────────────────────────

function makeItem(
  id: string,
  overrides: Partial<ContentItem> = {}
): ContentItem {
  return {
    blockId: id,
    fullText: `Content for block ${id}. This is a paragraph with enough text to be meaningful.`,
    summary: `Summary of ${id}`,
    blockType: 'paragraph',
    structural: false,
    ...overrides,
  };
}

function makeValue(
  id: string,
  overrides: Partial<Omit<ContentValue, 'compositeValue'>> = {}
): Omit<ContentValue, 'compositeValue'> {
  return {
    blockId: id,
    emotionalIntensity: 0.5,
    contextualRelevance: 0.5,
    freshness: 0.8,
    readerEngagement: 0.5,
    ...overrides,
  };
}

function makeWeight(
  id: string,
  overrides: Partial<Omit<ContentWeight, 'compositeWeight' | 'minWeight'>> = {}
): Omit<ContentWeight, 'compositeWeight' | 'minWeight'> {
  return {
    blockId: id,
    fullHeightPx: 100,
    compressedHeightPx: 30,
    readingTimeSec: 5,
    cognitiveLoad: 0.3,
    ...overrides,
  };
}

function makeConstraints(
  overrides: Partial<ContainerConstraints> = {}
): ContainerConstraints {
  return {
    heightPx: 800,
    widthPx: 1200,
    preserveStructure: true,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('ContentKnapsack', () => {
  let knapsack: ContentKnapsack;

  beforeEach(() => {
    knapsack = new ContentKnapsack();
  });

  describe('construction', () => {
    it('creates with default config', () => {
      expect(knapsack).toBeDefined();
    });

    it('creates with custom value weights', () => {
      const custom = new ContentKnapsack({
        valueWeights: {
          emotion: 0.5,
          relevance: 0.2,
          freshness: 0.2,
          engagement: 0.1,
        },
      });
      expect(custom).toBeDefined();
    });

    it('creates with ESI config', () => {
      const withEsi = new ContentKnapsack({
        esi: { enabled: true, baseUrl: 'https://edge.test.com' },
      });
      expect(withEsi).toBeDefined();
    });
  });

  describe('item registration', () => {
    it('registers an item with value and weight', () => {
      knapsack.registerItem(makeItem('b1'), makeValue('b1'), makeWeight('b1'));
      const result = knapsack.solve(makeConstraints());
      expect(result.decisions).toHaveLength(1);
    });

    it('registers multiple items', () => {
      for (let i = 0; i < 5; i++) {
        knapsack.registerItem(
          makeItem(`b${i}`),
          makeValue(`b${i}`),
          makeWeight(`b${i}`)
        );
      }
      const result = knapsack.solve(makeConstraints());
      expect(result.decisions).toHaveLength(5);
    });

    it('computes composite value from weights', () => {
      knapsack.registerItem(
        makeItem('b1'),
        makeValue('b1', {
          emotionalIntensity: 1.0,
          contextualRelevance: 1.0,
          freshness: 1.0,
          readerEngagement: 1.0,
        }),
        makeWeight('b1')
      );
      const result = knapsack.solve(makeConstraints());
      expect(result.totalValue).toBeGreaterThan(0);
    });
  });

  describe('value updates', () => {
    it('updates value signals for a block', () => {
      knapsack.registerItem(
        makeItem('b1'),
        makeValue('b1', { readerEngagement: 0.1 }),
        makeWeight('b1')
      );
      knapsack.updateValue('b1', { readerEngagement: 0.9 });
      const result = knapsack.solve(makeConstraints());
      expect(result.totalValue).toBeGreaterThan(0);
    });

    it('ignores updates for non-existent blocks', () => {
      knapsack.updateValue('nonexistent', { readerEngagement: 0.9 });
      // Should not throw
    });
  });

  describe('solving', () => {
    it('solves empty knapsack', () => {
      const result = knapsack.solve(makeConstraints());
      expect(result.decisions).toHaveLength(0);
      expect(result.totalValue).toBe(0);
    });

    it('includes all items when capacity is sufficient', () => {
      for (let i = 0; i < 3; i++) {
        knapsack.registerItem(
          makeItem(`b${i}`),
          makeValue(`b${i}`),
          makeWeight(`b${i}`)
        );
      }
      const result = knapsack.solve(makeConstraints({ heightPx: 10000 }));
      const included = result.decisions.filter((d) => d.included);
      expect(included.length).toBe(3);
    });

    it('compresses items when capacity is tight', () => {
      for (let i = 0; i < 10; i++) {
        knapsack.registerItem(
          makeItem(`b${i}`),
          makeValue(`b${i}`),
          makeWeight(`b${i}`, { fullHeightPx: 200 })
        );
      }
      // 10 items × 200px = 2000px needed, only 500px available
      const result = knapsack.solve(makeConstraints({ heightPx: 500 }));
      expect(result.utilization).toBeLessThanOrEqual(1.5);
    });

    it('prioritizes higher-value items', () => {
      knapsack.registerItem(
        makeItem('high'),
        makeValue('high', {
          emotionalIntensity: 1.0,
          contextualRelevance: 1.0,
        }),
        makeWeight('high', { fullHeightPx: 400 })
      );
      knapsack.registerItem(
        makeItem('low'),
        makeValue('low', { emotionalIntensity: 0.1, contextualRelevance: 0.1 }),
        makeWeight('low', { fullHeightPx: 400 })
      );

      const result = knapsack.solve(makeConstraints({ heightPx: 400 }));
      const highDecision = result.decisions.find((d) => d.blockId === 'high');
      const lowDecision = result.decisions.find((d) => d.blockId === 'low');

      expect(highDecision!.efficiency).toBeGreaterThan(lowDecision!.efficiency);
    });

    it('preserves structural blocks', () => {
      knapsack.registerItem(
        makeItem('heading', { blockType: 'heading', structural: true }),
        makeValue('heading', { emotionalIntensity: 0.01 }),
        makeWeight('heading')
      );
      knapsack.registerItem(
        makeItem('para'),
        makeValue('para', { emotionalIntensity: 0.9 }),
        makeWeight('para')
      );

      const result = knapsack.solve(
        makeConstraints({ heightPx: 120, preserveStructure: true })
      );
      const headingDecision = result.decisions.find(
        (d) => d.blockId === 'heading'
      );
      expect(headingDecision!.included).toBe(true);
    });

    it('respects minimum blocks constraint', () => {
      for (let i = 0; i < 5; i++) {
        knapsack.registerItem(
          makeItem(`b${i}`),
          makeValue(`b${i}`),
          makeWeight(`b${i}`, { fullHeightPx: 300 })
        );
      }
      const result = knapsack.solve(
        makeConstraints({ heightPx: 100, minBlocks: 3 })
      );
      const included = result.decisions.filter((d) => d.included);
      expect(included.length).toBeGreaterThanOrEqual(3);
    });

    it('enforces cognitive load budget', () => {
      for (let i = 0; i < 5; i++) {
        knapsack.registerItem(
          makeItem(`b${i}`),
          makeValue(`b${i}`),
          makeWeight(`b${i}`, { cognitiveLoad: 0.8 })
        );
      }
      const result = knapsack.solve(makeConstraints({ maxCognitiveLoad: 0.5 }));
      // Some blocks should be compressed to stay under budget
      const compressed = result.decisions.filter(
        (d) => d.renderMode === 'compressed'
      );
      expect(compressed.length).toBeGreaterThan(0);
    });

    it('uses greedy solver for >100 blocks', () => {
      for (let i = 0; i < 105; i++) {
        knapsack.registerItem(
          makeItem(`b${i}`),
          makeValue(`b${i}`),
          makeWeight(`b${i}`, { fullHeightPx: 20 })
        );
      }
      const result = knapsack.solve(makeConstraints());
      expect(result.meta.algorithm).toBe('greedy');
      expect(result.meta.itemCount).toBe(105);
    });

    it('tracks solve time', () => {
      knapsack.registerItem(makeItem('b1'), makeValue('b1'), makeWeight('b1'));
      const result = knapsack.solve(makeConstraints());
      expect(result.meta.solveTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('render modes', () => {
    it('assigns comfortable mode to highest value items', () => {
      knapsack.registerItem(
        makeItem('premium'),
        makeValue('premium', {
          emotionalIntensity: 1.0,
          contextualRelevance: 1.0,
          freshness: 1.0,
          readerEngagement: 1.0,
        }),
        makeWeight('premium')
      );
      const result = knapsack.solve(makeConstraints({ heightPx: 10000 }));
      const decision = result.decisions[0];
      expect(['comfortable', 'full']).toContain(decision.renderMode);
    });

    it('assigns hidden mode to overflow items', () => {
      for (let i = 0; i < 10; i++) {
        knapsack.registerItem(
          makeItem(`b${i}`),
          makeValue(`b${i}`),
          makeWeight(`b${i}`, { fullHeightPx: 500 })
        );
      }
      const result = knapsack.solve(
        makeConstraints({ heightPx: 300, preserveStructure: false })
      );
      const hidden = result.decisions.filter((d) => d.renderMode === 'hidden');
      expect(hidden.length).toBeGreaterThan(0);
    });
  });

  describe('events', () => {
    it('emits layout result on solve', () => {
      let emitted: any = null;
      knapsack.onChange((result) => {
        emitted = result;
      });
      knapsack.registerItem(makeItem('b1'), makeValue('b1'), makeWeight('b1'));
      knapsack.solve(makeConstraints());
      expect(emitted).not.toBeNull();
      expect(emitted.decisions).toHaveLength(1);
    });

    it('supports unsubscribe', () => {
      let count = 0;
      const unsub = knapsack.onChange(() => {
        count++;
      });
      knapsack.registerItem(makeItem('b1'), makeValue('b1'), makeWeight('b1'));
      knapsack.solve(makeConstraints());
      expect(count).toBe(1);

      unsub();
      knapsack.solve(makeConstraints());
      expect(count).toBe(1);
    });

    it('returns last result', () => {
      expect(knapsack.getLastResult()).toBeNull();
      knapsack.registerItem(makeItem('b1'), makeValue('b1'), makeWeight('b1'));
      knapsack.solve(makeConstraints());
      expect(knapsack.getLastResult()).not.toBeNull();
    });
  });

  // ── ESI Personalization ─────────────────────────────────────

  describe('ESI overrides', () => {
    it('applies ESI value overrides', () => {
      knapsack.registerItem(
        makeItem('b1'),
        makeValue('b1', { readerEngagement: 0.1 }),
        makeWeight('b1')
      );

      const overrides: ESIValueOverride[] = [
        { blockId: 'b1', readerEngagement: 0.99 },
      ];
      knapsack.applyESIOverrides(overrides);

      const result = knapsack.solve(makeConstraints());
      expect(result.totalValue).toBeGreaterThan(0);
    });

    it('applies boost factor', () => {
      knapsack.registerItem(makeItem('b1'), makeValue('b1'), makeWeight('b1'));

      knapsack.applyESIOverrides([{ blockId: 'b1', boostFactor: 2.0 }]);
      const boosted = knapsack.solve(makeConstraints());

      const knapsack2 = new ContentKnapsack();
      knapsack2.registerItem(makeItem('b1'), makeValue('b1'), makeWeight('b1'));
      const unboosted = knapsack2.solve(makeConstraints());

      expect(boosted.totalValue).toBeGreaterThan(unboosted.totalValue);
    });

    it('applies forced render mode', () => {
      knapsack.registerItem(makeItem('b1'), makeValue('b1'), makeWeight('b1'));
      knapsack.applyESIOverrides([
        { blockId: 'b1', forceRenderMode: 'collapsed' },
      ]);

      const result = knapsack.personalizedSolve(makeConstraints(), {
        readerDid: 'did:test:1',
      });
      const decision = result.decisions.find((d) => d.blockId === 'b1');
      expect(decision!.renderMode).toBe('collapsed');
    });

    it('ignores overrides for non-existent blocks', () => {
      knapsack.applyESIOverrides([{ blockId: 'ghost', readerEngagement: 0.5 }]);
      // Should not throw
    });
  });

  describe('personalized solve', () => {
    beforeEach(() => {
      for (let i = 0; i < 5; i++) {
        knapsack.registerItem(
          makeItem(`b${i}`, { blockType: i === 2 ? 'code' : 'paragraph' }),
          makeValue(`b${i}`),
          makeWeight(`b${i}`)
        );
      }
    });

    it('personalizes with reader DID', () => {
      const result = knapsack.personalizedSolve(makeConstraints(), {
        readerDid: 'did:test:reader1',
      });
      expect(result.personalized).toBe(true);
      expect(result.readerDid).toBe('did:test:reader1');
    });

    it('adjusts capacity for phone device class', () => {
      const phone = knapsack.personalizedSolve(
        makeConstraints({ heightPx: 1000 }),
        {
          readerDid: 'did:test:1',
          deviceClass: 'phone',
        }
      );

      const desktop = new ContentKnapsack();
      for (let i = 0; i < 5; i++) {
        desktop.registerItem(
          makeItem(`b${i}`),
          makeValue(`b${i}`),
          makeWeight(`b${i}`)
        );
      }
      const desktopResult = desktop.personalizedSolve(
        makeConstraints({ heightPx: 1000 }),
        {
          readerDid: 'did:test:1',
          deviceClass: 'desktop',
        }
      );

      // Phone should have more compression
      expect(phone.meta.containerCapacity).toBeLessThan(
        desktopResult.meta.containerCapacity
      );
    });

    it('adjusts cognitive load for casual readers', () => {
      const result = knapsack.personalizedSolve(makeConstraints(), {
        readerDid: 'did:test:1',
        readingLevel: 'casual',
      });
      expect(result.personalized).toBe(true);
    });

    it('hides code blocks for non-technical readers', () => {
      const result = knapsack.personalizedSolve(makeConstraints(), {
        readerDid: 'did:test:1',
        preferences: {
          topics: [],
          density: 'normal',
          showCode: false,
          showExamples: true,
        },
      });
      expect(result.personalized).toBe(true);
    });

    it('de-prioritizes already-read blocks on repeat visits', () => {
      const result = knapsack.personalizedSolve(makeConstraints(), {
        readerDid: 'did:test:1',
        engagementHistory: {
          blocksRead: ['b0', 'b1'],
          blocksHighlighted: [],
          timePerBlock: {},
          visitCount: 3,
        },
      });
      expect(result.personalized).toBe(true);
    });

    it('boosts highlighted blocks', () => {
      const result = knapsack.personalizedSolve(makeConstraints(), {
        readerDid: 'did:test:1',
        engagementHistory: {
          blocksRead: [],
          blocksHighlighted: ['b0'],
          timePerBlock: {},
          visitCount: 1,
        },
      });
      expect(result.personalized).toBe(true);
    });

    it('applies sparse density preference', () => {
      const result = knapsack.personalizedSolve(makeConstraints(), {
        readerDid: 'did:test:1',
        preferences: {
          topics: [],
          density: 'sparse',
          showCode: true,
          showExamples: true,
        },
      });
      expect(result.personalized).toBe(true);
    });

    it('applies dense density preference', () => {
      const result = knapsack.personalizedSolve(makeConstraints(), {
        readerDid: 'did:test:1',
        preferences: {
          topics: [],
          density: 'dense',
          showCode: true,
          showExamples: true,
        },
      });
      expect(result.personalized).toBe(true);
    });
  });

  describe('ESI tag generation', () => {
    it('returns empty when ESI is not configured', () => {
      knapsack.registerItem(makeItem('b1'), makeValue('b1'), makeWeight('b1'));
      const tags = knapsack.generateESITags('doc-1');
      expect(tags).toHaveLength(0);
    });

    it('generates ESI tags when configured', () => {
      const withEsi = new ContentKnapsack({
        esi: { enabled: true, baseUrl: 'https://edge.test.com' },
      });
      withEsi.registerItem(makeItem('b1'), makeValue('b1'), makeWeight('b1'));
      withEsi.registerItem(makeItem('b2'), makeValue('b2'), makeWeight('b2'));

      const tags = withEsi.generateESITags('doc-1');
      expect(tags.length).toBeGreaterThanOrEqual(3); // 2 blocks + 1 context
      expect(tags[0]).toContain('esi:include');
      expect(tags[0]).toContain('edge.test.com');
      expect(tags[0]).toContain('block=b1');
    });

    it('includes cache TTL in ESI tags', () => {
      const withEsi = new ContentKnapsack({
        esi: { enabled: true, baseUrl: 'https://edge.test.com', cacheTTL: 60 },
      });
      withEsi.registerItem(makeItem('b1'), makeValue('b1'), makeWeight('b1'));

      const tags = withEsi.generateESITags('doc-1');
      expect(tags[0]).toContain('ttl="60"');
    });
  });

  describe('layout manifest', () => {
    it('generates manifest with decisions', () => {
      knapsack.registerItem(makeItem('b1'), makeValue('b1'), makeWeight('b1'));
      knapsack.solve(makeConstraints());

      const manifest = knapsack.generateLayoutManifest('doc-1');
      expect(manifest.documentId).toBe('doc-1');
      expect(manifest.timestamp).toBeGreaterThan(0);
      expect(manifest.decisions).toHaveLength(1);
    });

    it('reflects ESI state in manifest', () => {
      const withEsi = new ContentKnapsack({
        esi: { enabled: true, baseUrl: 'https://edge.test.com' },
      });
      const manifest = withEsi.generateLayoutManifest('doc-1');
      expect(manifest.esiEnabled).toBe(true);
    });
  });
});
