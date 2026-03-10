import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { KnowledgeFabric } from './KnowledgeFabric';

// ── Helpers ─────────────────────────────────────────────────────────

const mockCorpusSearch = vi.fn().mockResolvedValue([
  {
    documentId: 'doc-2',
    documentTitle: 'Related Document',
    blockId: 'related-b1',
    text: 'Related content that supports the current block.',
    similarity: 0.85,
    embedding: new Float32Array([0.1, 0.2, 0.3]),
  },
]);

function makeConfig(overrides: any = {}) {
  return {
    corpusSearch: mockCorpusSearch,
    minSimilarity: 0.3,
    maxPerBlock: 5,
    autoSurface: false,
    debounceMs: 0,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('KnowledgeFabric', () => {
  let fabric: KnowledgeFabric;

  beforeEach(() => {
    mockCorpusSearch.mockClear();
    fabric = new KnowledgeFabric(makeConfig());
  });

  afterEach(() => {
    fabric.dispose();
  });

  describe('construction', () => {
    it('creates with required config', () => {
      expect(fabric).toBeDefined();
    });

    it('creates with inferFn', () => {
      const f = new KnowledgeFabric(
        makeConfig({
          inferFn: vi
            .fn()
            .mockResolvedValue(JSON.stringify({ relationship: 'supports' })),
        })
      );
      expect(f).toBeDefined();
      f.dispose();
    });
  });

  describe('fetchSuggestions', () => {
    it('fetches suggestions for a block', async () => {
      const suggestions = await fabric.fetchSuggestions(
        'block-0',
        'Test content about AI',
        new Float32Array([0.1, 0.2]),
        'doc-1'
      );
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].sourceDocumentId).toBe('doc-2');
    });

    it('calls corpus search with embedding', async () => {
      const embedding = new Float32Array([0.5, 0.6]);
      await fabric.fetchSuggestions('block-0', 'Text', embedding, 'doc-1');
      expect(mockCorpusSearch).toHaveBeenCalledWith(
        embedding,
        expect.objectContaining({ excludeDocId: 'doc-1' })
      );
    });

    it('classifies relationship type', async () => {
      const suggestions = await fabric.fetchSuggestions(
        'block-0',
        'Text',
        new Float32Array([0.1]),
        'doc-1'
      );
      expect(suggestions[0].relationship).toBeTruthy();
    });

    it('suggests usage type', async () => {
      const suggestions = await fabric.fetchSuggestions(
        'block-0',
        'Text',
        new Float32Array([0.1]),
        'doc-1'
      );
      expect(suggestions[0].usage).toBeTruthy();
    });
  });

  describe('getSuggestions', () => {
    it('returns cached suggestions for a block', async () => {
      await fabric.fetchSuggestions(
        'block-0',
        'Text',
        new Float32Array([0.1]),
        'doc-1'
      );
      const cached = fabric.getSuggestions('block-0');
      expect(cached.length).toBeGreaterThan(0);
    });

    it('returns empty for unfetched block', () => {
      expect(fabric.getSuggestions('nonexistent')).toEqual([]);
    });
  });

  describe('getAllSuggestions', () => {
    it('returns all suggestions across blocks', async () => {
      await fabric.fetchSuggestions(
        'b0',
        'Text 0',
        new Float32Array([0.1]),
        'doc-1'
      );
      await fabric.fetchSuggestions(
        'b1',
        'Text 1',
        new Float32Array([0.2]),
        'doc-1'
      );

      const all = fabric.getAllSuggestions();
      expect(all.size).toBe(2);
    });
  });

  describe('useSuggestion', () => {
    it('marks a suggestion as used', async () => {
      const suggestions = await fabric.fetchSuggestions(
        'b0',
        'Text',
        new Float32Array([0.1]),
        'doc-1'
      );
      const used = fabric.useSuggestion(suggestions[0].id);
      expect(used).toBeDefined();
      expect(used!.resolved).toBe(true);
    });

    it('returns undefined for unknown suggestion', () => {
      expect(fabric.useSuggestion('fake-id')).toBeUndefined();
    });
  });

  describe('dismissSuggestion', () => {
    it('dismisses a suggestion', async () => {
      const suggestions = await fabric.fetchSuggestions(
        'b0',
        'Text',
        new Float32Array([0.1]),
        'doc-1'
      );
      fabric.dismissSuggestion(suggestions[0].id);
      // Should not throw
    });
  });

  describe('getUnseenCount', () => {
    it('counts unseen suggestions', async () => {
      await fabric.fetchSuggestions(
        'b0',
        'Text',
        new Float32Array([0.1]),
        'doc-1'
      );
      expect(fabric.getUnseenCount()).toBeGreaterThan(0);
    });

    it('returns 0 when empty', () => {
      expect(fabric.getUnseenCount()).toBe(0);
    });
  });

  describe('surfaceForBlock (debounced)', () => {
    it('calls corpus search after debounce', async () => {
      const debounced = new KnowledgeFabric(
        makeConfig({ debounceMs: 10, autoSurface: true })
      );
      debounced.surfaceForBlock('b0', 'Text', new Float32Array([0.1]), 'doc-1');

      // Wait for debounce
      await new Promise((r) => setTimeout(r, 50));
      expect(mockCorpusSearch).toHaveBeenCalled();
      debounced.dispose();
    });
  });

  describe('events', () => {
    it('emits suggestions for new blocks', async () => {
      let emitted = false;
      fabric.onChange(() => {
        emitted = true;
      });
      await fabric.fetchSuggestions(
        'b0',
        'Text',
        new Float32Array([0.1]),
        'doc-1'
      );
      expect(emitted).toBe(true);
    });

    it('supports unsubscribe', async () => {
      let count = 0;
      const unsub = fabric.onChange(() => {
        count++;
      });
      await fabric.fetchSuggestions(
        'b0',
        'Text',
        new Float32Array([0.1]),
        'doc-1'
      );
      expect(count).toBe(1);
      unsub();
      await fabric.fetchSuggestions(
        'b1',
        'Text',
        new Float32Array([0.1]),
        'doc-1'
      );
      expect(count).toBe(1);
    });
  });

  describe('dispose', () => {
    it('clears timers on dispose', () => {
      fabric.dispose();
      // Should not throw on double dispose
      fabric.dispose();
    });
  });
});
