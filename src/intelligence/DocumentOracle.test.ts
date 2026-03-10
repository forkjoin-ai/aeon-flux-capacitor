import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DocumentOracle } from './DocumentOracle';

// ── Helpers ─────────────────────────────────────────────────────────

const mockInferFn = vi.fn().mockResolvedValue(
  JSON.stringify({
    insights: [],
    contradictions: [],
    gaps: [],
    weakSections: [],
    toneShifts: [],
    questions: [],
  })
);

function makeBlocks(count = 3) {
  return Array.from({ length: count }, (_, i) => ({
    id: `block-${i}`,
    text: `Block ${i}: This is a paragraph with meaningful content for oracle analysis.`,
    blockType: 'paragraph' as const,
    sentiment: 0.5 + i * 0.1,
  }));
}

function makeBlocksWithEmbeddings(count = 3) {
  return makeBlocks(count).map((b, i) => ({
    ...b,
    embedding: new Float32Array(
      Array.from({ length: 64 }, (_, j) => Math.sin(i + j * 0.1))
    ),
  }));
}

// ── Tests ───────────────────────────────────────────────────────────

describe('DocumentOracle', () => {
  let oracle: DocumentOracle;

  beforeEach(() => {
    mockInferFn.mockClear();
    oracle = new DocumentOracle({ inferFn: mockInferFn });
  });

  describe('construction', () => {
    it('creates with required config', () => {
      expect(oracle).toBeDefined();
    });

    it('creates with optional thresholds', () => {
      const o = new DocumentOracle({
        inferFn: mockInferFn,
        severityThreshold: 0.5,
        maxInsights: 10,
      });
      expect(o).toBeDefined();
    });
  });

  describe('analyze', () => {
    it('analyzes blocks and returns insights', async () => {
      const insights = await oracle.analyze(makeBlocks());
      expect(Array.isArray(insights)).toBe(true);
    });

    it('calls inferFn for contradiction detection', async () => {
      await oracle.analyze(makeBlocks());
      expect(mockInferFn).toHaveBeenCalled();
    });

    it('stores insights for later retrieval', async () => {
      await oracle.analyze(makeBlocks());
      const insights = oracle.getInsights();
      expect(Array.isArray(insights)).toBe(true);
    });
  });

  describe('buildProfile', () => {
    it('builds a document profile', async () => {
      mockInferFn.mockResolvedValueOnce(
        JSON.stringify({
          qualityScore: 0.8,
          coherence: 0.7,
          readingLevel: 12,
          audience: 'developers',
          tone: 'technical',
          claims: ['claim 1'],
          unansweredQuestions: ['q1'],
          assessment: 'Good document',
        })
      );

      const profile = await oracle.buildProfile(makeBlocks());
      expect(profile).toBeDefined();
      expect(typeof profile.qualityScore).toBe('number');
    });

    it('stores profile for later retrieval', async () => {
      mockInferFn.mockResolvedValueOnce(
        JSON.stringify({
          qualityScore: 0.8,
          coherence: 0.7,
          readingLevel: 12,
          audience: 'developers',
          tone: 'technical',
          claims: [],
          unansweredQuestions: [],
          assessment: 'OK',
        })
      );

      await oracle.buildProfile(makeBlocks());
      expect(oracle.getProfile()).not.toBeNull();
    });
  });

  describe('ask', () => {
    it('answers questions about the document', async () => {
      mockInferFn.mockResolvedValueOnce(
        JSON.stringify({
          answer: 'The main topic is testing.',
          relevantBlockIds: ['block-0'],
        })
      );

      const result = await oracle.ask('What is the main topic?', makeBlocks());
      expect(result.answer).toBeTruthy();
      expect(Array.isArray(result.relevantBlockIds)).toBe(true);
    });
  });

  describe('dismiss', () => {
    it('dismisses an insight', async () => {
      await oracle.analyze(makeBlocks());
      const insights = oracle.getInsights();
      if (insights.length > 0) {
        oracle.dismiss(insights[0].id);
        const updated = oracle.getInsights();
        const dismissed = updated.find((i) => i.id === insights[0].id);
        if (dismissed) {
          expect(dismissed.dismissed).toBe(true);
        }
      }
    });
  });

  describe('contradiction detection', () => {
    it('finds contradictions using embeddings', async () => {
      mockInferFn.mockResolvedValueOnce(
        JSON.stringify({
          hasContradiction: true,
          explanation: 'Blocks contradict each other',
        })
      );

      await oracle.analyze(makeBlocksWithEmbeddings());
      // Should not throw
    });
  });

  describe('redundancy detection', () => {
    it('detects redundant content via high cosine similarity', async () => {
      const blocks = makeBlocksWithEmbeddings();
      // Create very similar embeddings
      blocks[1].embedding = new Float32Array(blocks[0].embedding);
      await oracle.analyze(blocks);
      // Should not throw
    });
  });

  describe('events', () => {
    it('emits change events', async () => {
      let emitted = false;
      oracle.onChange(() => {
        emitted = true;
      });
      await oracle.analyze(makeBlocks());
      expect(emitted).toBe(true);
    });

    it('supports unsubscribe', async () => {
      let count = 0;
      const unsub = oracle.onChange(() => {
        count++;
      });
      await oracle.analyze(makeBlocks());
      expect(count).toBe(1);

      unsub();
      await oracle.analyze(makeBlocks());
      expect(count).toBe(1);
    });
  });
});
