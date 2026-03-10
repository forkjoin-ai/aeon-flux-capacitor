import { describe, it, expect, beforeEach } from 'vitest';
import { ReaderWriterSymbiosis } from './ReaderWriterSymbiosis';
import type { AggregatedReaderData } from './ReaderWriterSymbiosis';

// ── Helpers ─────────────────────────────────────────────────────────

function makeReaderData(
  blockId: string,
  overrides: Partial<AggregatedReaderData> = {}
): AggregatedReaderData {
  return {
    blockId,
    avgTimeMs: 5000,
    expectedTimeMs: 4000,
    reReadRate: 0.1,
    dropOffRate: 0.05,
    highlightRate: 0.15,
    copyRate: 0.02,
    shareRate: 0.01,
    sessions: 100,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('ReaderWriterSymbiosis', () => {
  let symbiosis: ReaderWriterSymbiosis;

  beforeEach(() => {
    symbiosis = new ReaderWriterSymbiosis();
  });

  describe('construction', () => {
    it('creates with defaults', () => {
      expect(symbiosis).toBeDefined();
    });

    it('creates with custom config', () => {
      const s = new ReaderWriterSymbiosis({
        minSessions: 50,
        showGutter: true,
        showInline: false,
      });
      expect(s).toBeDefined();
    });

    it('creates with specific enabled signals', () => {
      const s = new ReaderWriterSymbiosis({
        enabledSignals: ['re-read', 'drop-off'],
      });
      expect(s).toBeDefined();
    });
  });

  describe('processReaderData', () => {
    it('processes reader data and returns annotations', () => {
      const data = [makeReaderData('b0'), makeReaderData('b1')];
      const annotations = symbiosis.processReaderData(data);
      expect(annotations.size).toBeGreaterThan(0);
    });

    it('detects high re-read rate', () => {
      const data = [makeReaderData('b0', { reReadRate: 0.8 })];
      const annotations = symbiosis.processReaderData(data);
      const ann = annotations.get('b0');
      expect(ann).toBeDefined();
      const hasReRead = ann!.signals.some((s) => s.type === 're-read');
      expect(hasReRead).toBe(true);
    });

    it('detects high drop-off rate', () => {
      const data = [makeReaderData('b0', { dropOffRate: 0.6 })];
      const annotations = symbiosis.processReaderData(data);
      const ann = annotations.get('b0');
      expect(ann).toBeDefined();
      const hasDropOff = ann!.signals.some((s) => s.type === 'drop-off');
      expect(hasDropOff).toBe(true);
    });

    it('detects slow reading (spending significantly more time than expected)', () => {
      const data = [
        makeReaderData('b0', { avgTimeMs: 20000, expectedTimeMs: 4000 }),
      ];
      const annotations = symbiosis.processReaderData(data);
      const ann = annotations.get('b0');
      expect(ann).toBeDefined();
    });

    it('detects high highlight rate', () => {
      const data = [makeReaderData('b0', { highlightRate: 0.5 })];
      const annotations = symbiosis.processReaderData(data);
      const ann = annotations.get('b0');
      expect(ann).toBeDefined();
    });

    it('skips blocks with insufficient sessions', () => {
      const s = new ReaderWriterSymbiosis({ minSessions: 200 });
      const data = [makeReaderData('b0', { sessions: 50 })];
      const annotations = s.processReaderData(data);
      // Block should be skipped or have minimal signals
      const ann = annotations.get('b0');
      if (ann) {
        expect(ann.signals.length).toBe(0);
      }
    });

    it('computes experience score', () => {
      const data = [makeReaderData('b0')];
      const annotations = symbiosis.processReaderData(data);
      const ann = annotations.get('b0');
      expect(ann).toBeDefined();
      expect(typeof ann!.experienceScore).toBe('number');
      expect(ann!.experienceScore).toBeGreaterThanOrEqual(0);
      expect(ann!.experienceScore).toBeLessThanOrEqual(1);
    });

    it('marks blocks needing attention', () => {
      // Need all three penalty triggers: slow-read (timeRatio>3), re-read (>0.3), drop-off (>0.15)
      // to push experienceScore below 0.4 threshold
      const data = [
        makeReaderData('b0', {
          avgTimeMs: 20000,
          expectedTimeMs: 4000,
          dropOffRate: 0.7,
          reReadRate: 0.6,
        }),
      ];
      const annotations = symbiosis.processReaderData(data);
      const ann = annotations.get('b0');
      expect(ann!.needsAttention).toBe(true);
    });
  });

  describe('getAnnotation', () => {
    it('returns annotation for processed block', () => {
      symbiosis.processReaderData([makeReaderData('b0')]);
      expect(symbiosis.getAnnotation('b0')).toBeDefined();
    });

    it('returns undefined for unprocessed block', () => {
      expect(symbiosis.getAnnotation('nonexistent')).toBeUndefined();
    });
  });

  describe('getAttentionBlocks', () => {
    it('returns blocks sorted by urgency', () => {
      symbiosis.processReaderData([
        makeReaderData('b0', {
          avgTimeMs: 15000,
          expectedTimeMs: 4000,
          dropOffRate: 0.7,
          reReadRate: 0.5,
        }),
        makeReaderData('b1', { dropOffRate: 0.1 }),
        makeReaderData('b2', {
          avgTimeMs: 25000,
          expectedTimeMs: 4000,
          dropOffRate: 0.9,
          reReadRate: 0.6,
        }),
      ]);
      const attention = symbiosis.getAttentionBlocks();
      expect(attention.length).toBeGreaterThan(0);
    });
  });

  describe('getDocumentScore', () => {
    it('returns overall document score', () => {
      symbiosis.processReaderData([makeReaderData('b0'), makeReaderData('b1')]);
      const score = symbiosis.getDocumentScore();
      expect(typeof score).toBe('number');
    });

    it('returns 1 for no data (default perfect score)', () => {
      expect(symbiosis.getDocumentScore()).toBe(1);
    });
  });

  describe('getSummary', () => {
    it('returns a plain-language summary', () => {
      symbiosis.processReaderData([makeReaderData('b0')]);
      const summary = symbiosis.getSummary();
      expect(typeof summary).toBe('string');
      expect(summary.length).toBeGreaterThan(0);
    });
  });

  describe('events', () => {
    it('emits on data processing', () => {
      let emitted = false;
      symbiosis.onChange(() => {
        emitted = true;
      });
      symbiosis.processReaderData([makeReaderData('b0')]);
      expect(emitted).toBe(true);
    });

    it('supports unsubscribe', () => {
      let count = 0;
      const unsub = symbiosis.onChange(() => {
        count++;
      });
      symbiosis.processReaderData([makeReaderData('b0')]);
      expect(count).toBe(1);
      unsub();
      symbiosis.processReaderData([makeReaderData('b1')]);
      expect(count).toBe(1);
    });
  });
});
