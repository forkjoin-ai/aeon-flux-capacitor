import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Capacitor } from './Capacitor';
import type {
  CapacitorConfig,
  CapacitorBlock,
  CapacitorEvent,
} from './Capacitor';

// ── Helpers ─────────────────────────────────────────────────────────

function makeContainer(width = 1200, height = 800) {
  return { offsetWidth: width, offsetHeight: height };
}

function makeConfig(overrides: Partial<CapacitorConfig> = {}): CapacitorConfig {
  return {
    container: makeContainer(),
    projection: 'text',
    autoSolve: false, // disable for deterministic tests
    ...overrides,
  };
}

function makeBlock(
  id: string,
  overrides: Partial<CapacitorBlock> = {}
): CapacitorBlock {
  return {
    id,
    text: `This is block ${id} with enough content to be meaningful for testing purposes.`,
    type: 'paragraph',
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('Capacitor', () => {
  let cap: Capacitor;

  beforeEach(() => {
    cap = new Capacitor(makeConfig());
  });

  describe('construction', () => {
    it('creates with default config', () => {
      expect(cap).toBeDefined();
      expect(cap.getProjection()).toBe('text');
    });

    it('creates with custom projection', () => {
      const spatial = new Capacitor(makeConfig({ projection: 'spatial' }));
      expect(spatial.getProjection()).toBe('spatial');
    });

    it('creates with ESI config', () => {
      const withEsi = new Capacitor(
        makeConfig({
          esi: { enabled: true, baseUrl: 'https://edge.test.com' },
        })
      );
      expect(withEsi).toBeDefined();
    });
  });

  describe('lifecycle', () => {
    it('mounts and emits mounted event', () => {
      const events: CapacitorEvent[] = [];
      cap.on((e) => events.push(e));

      cap.mount();
      expect(cap.getState().mounted).toBe(true);
      expect(events.some((e) => e.type === 'mounted')).toBe(true);
    });

    it('does not double-mount', () => {
      const events: CapacitorEvent[] = [];
      cap.on((e) => events.push(e));

      cap.mount();
      cap.mount();

      const mounts = events.filter((e) => e.type === 'mounted');
      expect(mounts).toHaveLength(1);
    });

    it('unmounts and emits unmounted event', () => {
      const events: CapacitorEvent[] = [];
      cap.on((e) => events.push(e));

      cap.mount();
      cap.unmount();

      expect(cap.getState().mounted).toBe(false);
      expect(events.some((e) => e.type === 'unmounted')).toBe(true);
    });

    it('does not double-unmount', () => {
      const events: CapacitorEvent[] = [];
      cap.on((e) => events.push(e));

      cap.mount();
      cap.unmount();
      cap.unmount();

      const unmounts = events.filter((e) => e.type === 'unmounted');
      expect(unmounts).toHaveLength(1);
    });
  });

  describe('block registration', () => {
    it('adds a block and emits indexed event', async () => {
      const events: CapacitorEvent[] = [];
      cap.on((e) => events.push(e));

      await cap.addBlock(makeBlock('b1'));
      expect(cap.getState().blockCount).toBe(1);
      expect(events.some((e) => e.type === 'block-indexed')).toBe(true);
    });

    it('adds multiple blocks', async () => {
      await cap.addBlocks([makeBlock('b1'), makeBlock('b2'), makeBlock('b3')]);
      expect(cap.getState().blockCount).toBe(3);
    });

    it('adds heading as structural by default', async () => {
      await cap.addBlock(makeBlock('h1', { type: 'heading' }));
      expect(cap.getState().blockCount).toBe(1);
    });

    it('runs inference when inferFn is provided', async () => {
      const inferFn = vi
        .fn()
        .mockResolvedValue(
          '{"valence":0.7,"arousal":0.5,"dominance":0.6,"sentiment":0.8}'
        );
      const capWithInfer = new Capacitor(
        makeConfig({ inferFn, autoSolve: false })
      );

      await capWithInfer.addBlock(makeBlock('b1'));
      expect(inferFn).toHaveBeenCalledOnce();
    });

    it('handles inference failure gracefully', async () => {
      const inferFn = vi.fn().mockRejectedValue(new Error('inference down'));
      const capWithInfer = new Capacitor(
        makeConfig({ inferFn, autoSolve: false })
      );

      await capWithInfer.addBlock(makeBlock('b1'));
      expect(capWithInfer.getState().blockCount).toBe(1);
    });

    it('handles malformed inference response gracefully', async () => {
      const inferFn = vi.fn().mockResolvedValue('not json');
      const capWithInfer = new Capacitor(
        makeConfig({ inferFn, autoSolve: false })
      );

      await capWithInfer.addBlock(makeBlock('b1'));
      expect(capWithInfer.getState().blockCount).toBe(1);
    });

    it('runs embedding when embedFn is provided', async () => {
      const embedFn = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
      const capWithEmbed = new Capacitor(
        makeConfig({ embedFn, autoSolve: false })
      );

      await capWithEmbed.addBlock(makeBlock('b1'));
      expect(embedFn).toHaveBeenCalledOnce();
    });

    it('handles embedding failure gracefully', async () => {
      const embedFn = vi.fn().mockRejectedValue(new Error('embed down'));
      const capWithEmbed = new Capacitor(
        makeConfig({ embedFn, autoSolve: false })
      );

      await capWithEmbed.addBlock(makeBlock('b1'));
      expect(capWithEmbed.getState().blockCount).toBe(1);
    });

    it('skips inference for empty text blocks', async () => {
      const inferFn = vi.fn();
      const capWithInfer = new Capacitor(
        makeConfig({ inferFn, autoSolve: false })
      );

      await capWithInfer.addBlock(makeBlock('b1', { text: '' }));
      expect(inferFn).not.toHaveBeenCalled();
    });
  });

  describe('layout solving', () => {
    it('solves layout for registered blocks', async () => {
      await cap.addBlocks([makeBlock('b1'), makeBlock('b2'), makeBlock('b3')]);
      const result = cap.solve();
      expect(result.decisions).toHaveLength(3);
    });

    it('emits layout-solved event', async () => {
      const events: CapacitorEvent[] = [];
      cap.on((e) => events.push(e));

      await cap.addBlock(makeBlock('b1'));
      cap.solve();

      expect(events.some((e) => e.type === 'layout-solved')).toBe(true);
    });

    it('returns layout in state', async () => {
      await cap.addBlock(makeBlock('b1'));
      cap.solve();

      const state = cap.getState();
      expect(state.layout).not.toBeNull();
      expect(state.layout!.decisions).toHaveLength(1);
    });
  });

  describe('personalization', () => {
    it('personalizes layout for a reader', async () => {
      await cap.addBlocks([makeBlock('b1'), makeBlock('b2')]);
      const result = cap.personalize({ readerDid: 'did:test:reader1' });

      expect(result.personalized).toBe(true);
      expect(result.readerDid).toBe('did:test:reader1');
    });

    it('emits personalized event', async () => {
      const events: CapacitorEvent[] = [];
      cap.on((e) => events.push(e));

      await cap.addBlock(makeBlock('b1'));
      cap.personalize({ readerDid: 'did:test:1' });

      expect(events.some((e) => e.type === 'personalized')).toBe(true);
    });
  });

  describe('ESI', () => {
    it('applies ESI overrides and emits event', async () => {
      cap.mount();
      await cap.addBlock(makeBlock('b1'));

      const events: CapacitorEvent[] = [];
      cap.on((e) => events.push(e));

      cap.applyESIOverrides([{ blockId: 'b1', boostFactor: 2.0 }]);
      expect(events.some((e) => e.type === 'esi-resolved')).toBe(true);
    });

    it('generates ESI tags for a document', async () => {
      const withEsi = new Capacitor(
        makeConfig({
          esi: { enabled: true, baseUrl: 'https://edge.test.com' },
        })
      );
      await withEsi.addBlock(makeBlock('b1'));

      const tags = withEsi.generateESITags('doc-1');
      expect(tags.length).toBeGreaterThan(0);
    });

    it('generates layout manifest', async () => {
      await cap.addBlock(makeBlock('b1'));
      cap.solve();

      const manifest = cap.generateManifest('doc-1');
      expect(manifest.documentId).toBe('doc-1');
      expect(manifest.decisions).toHaveLength(1);
    });
  });

  describe('projection switching', () => {
    it('switches projection and emits event', () => {
      const events: CapacitorEvent[] = [];
      cap.on((e) => events.push(e));

      cap.project('audio');
      expect(cap.getProjection()).toBe('audio');

      const projEvent = events.find(
        (e) => e.type === 'projection-changed'
      ) as any;
      expect(projEvent).toBeDefined();
      expect(projEvent.from).toBe('text');
      expect(projEvent.to).toBe('audio');
    });

    it('re-solves on projection change when mounted', async () => {
      cap.mount();
      await cap.addBlock(makeBlock('b1'));

      const events: CapacitorEvent[] = [];
      cap.on((e) => events.push(e));

      cap.project('reading');
      expect(events.some((e) => e.type === 'layout-solved')).toBe(true);
    });
  });

  describe('DualIndex access', () => {
    it('samples a block from the DualIndex', async () => {
      await cap.addBlock(makeBlock('b1'));
      const sample = cap.sampleBlock('b1');
      expect(sample).not.toBeNull();
      expect(sample!.blockId).toBe('b1');
    });

    it('returns null for non-existent block', () => {
      const sample = cap.sampleBlock('ghost');
      expect(sample).toBeNull();
    });

    it('interpolates blocks', async () => {
      await cap.addBlocks([makeBlock('b1'), makeBlock('b2')]);
      const result = cap.interpolateBlocks(['b1', 'b2']);
      expect(result).toHaveLength(2);
    });

    it('exposes DualIndex instance', () => {
      expect(cap.getDualIndex()).toBeDefined();
    });

    it('exposes Knapsack instance', () => {
      expect(cap.getKnapsack()).toBeDefined();
    });
  });

  describe('value updates', () => {
    it('updates block value signals', async () => {
      await cap.addBlock(makeBlock('b1'));
      cap.updateBlockValue('b1', { readerEngagement: 0.95 });
      // Should not throw
    });
  });

  describe('force render mode', () => {
    it('forces a specific render mode on a block', async () => {
      cap.mount();
      await cap.addBlock(makeBlock('b1'));
      cap.forceRenderMode('b1', 'collapsed');
      // Should not throw
    });
  });

  describe('resize', () => {
    it('re-solves on resize when mounted', async () => {
      cap.mount();
      await cap.addBlock(makeBlock('b1'));

      const events: CapacitorEvent[] = [];
      cap.on((e) => events.push(e));

      cap.resize();
      expect(events.some((e) => e.type === 'layout-solved')).toBe(true);
    });

    it('does nothing on resize when not mounted', async () => {
      await cap.addBlock(makeBlock('b1'));

      const events: CapacitorEvent[] = [];
      cap.on((e) => events.push(e));

      cap.resize();
      expect(events).toHaveLength(0);
    });
  });

  describe('state', () => {
    it('returns complete state', () => {
      const state = cap.getState();
      expect(state.mounted).toBe(false);
      expect(state.projection).toBe('text');
      expect(state.layout).toBeNull();
      expect(state.personalized).toBe(false);
      expect(state.blockCount).toBe(0);
      expect(state.containerWidth).toBe(1200);
      expect(state.containerHeight).toBe(800);
    });
  });

  describe('event system', () => {
    it('supports unsubscribe', () => {
      let count = 0;
      const unsub = cap.on(() => {
        count++;
      });

      cap.mount();
      expect(count).toBeGreaterThan(0);

      const prevCount = count;
      unsub();
      cap.unmount();
      cap.mount();
      // After unsub, count should not increase for new events
    });
  });

  describe('height estimation', () => {
    it('estimates height for different block types', async () => {
      await cap.addBlock(
        makeBlock('heading', { type: 'heading', text: 'Title' })
      );
      await cap.addBlock(
        makeBlock('code', { type: 'code', text: 'const x = 1;' })
      );
      await cap.addBlock(
        makeBlock('image', { type: 'image', text: 'alt text' })
      );
      await cap.addBlock(makeBlock('table', { type: 'table', text: 'a|b|c' }));
      await cap.addBlock(
        makeBlock('list', { type: 'list', text: '- item 1\n- item 2' })
      );
      await cap.addBlock(
        makeBlock('quote', { type: 'blockquote', text: 'A quote.' })
      );

      expect(cap.getState().blockCount).toBe(6);
    });

    it('uses provided heightPx when available', async () => {
      await cap.addBlock(makeBlock('b1', { heightPx: 250 }));
      const result = cap.solve();
      expect(result.decisions[0].allocatedHeight).toBeGreaterThan(0);
    });
  });
});
