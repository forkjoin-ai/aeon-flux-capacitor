import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EmotionalResonance } from './EmotionalResonance';

// ── Helpers ─────────────────────────────────────────────────────────

const mockInferFn = vi.fn().mockResolvedValue(
  JSON.stringify({
    primaryEmotion: 'curiosity',
    secondaryEmotions: ['surprise'],
    intensity: 0.7,
    valence: 0.6,
    arousal: 0.5,
    dominance: 0.4,
    empathy: 0.6,
    persuasion: 0.5,
    audienceReactions: [
      {
        audience: 'developers',
        reaction: 'interest',
        intensity: 0.7,
        reason: 'Technical content',
      },
    ],
    alienationRisk: null,
  })
);

function makeBlocks(count = 3) {
  return Array.from({ length: count }, (_, i) => ({
    id: `block-${i}`,
    text: `Block ${i}: This paragraph explores important themes that evoke different emotional responses.`,
    sentiment: 0.3 + i * 0.2,
  }));
}

// ── Tests ───────────────────────────────────────────────────────────

describe('EmotionalResonance', () => {
  let resonance: EmotionalResonance;

  beforeEach(() => {
    mockInferFn.mockClear();
    resonance = new EmotionalResonance({ inferFn: mockInferFn });
  });

  describe('construction', () => {
    it('creates with required config', () => {
      expect(resonance).toBeDefined();
    });

    it('creates with audiences', () => {
      const r = new EmotionalResonance({
        inferFn: mockInferFn,
        audiences: ['teens', 'professionals'],
      });
      expect(r).toBeDefined();
    });

    it('creates with alienation checking', () => {
      const r = new EmotionalResonance({
        inferFn: mockInferFn,
        checkAlienation: true,
      });
      expect(r).toBeDefined();
    });
  });

  describe('predictImpact', () => {
    it('predicts emotional impact of a block', async () => {
      const impact = await resonance.predictImpact(
        'block-0',
        'A deeply moving story about courage.'
      );
      expect(impact).toBeDefined();
      expect(impact.blockId).toBe('block-0');
      expect(typeof impact.intensity).toBe('number');
    });

    it('uses context for better prediction', async () => {
      await resonance.predictImpact('block-0', 'A deeply moving story.', {
        precedingText: 'The war was brutal.',
        documentTone: 'somber',
        authorIntent: 'evoke empathy',
      });
      expect(mockInferFn).toHaveBeenCalled();
    });

    it('stores impact for later retrieval', async () => {
      await resonance.predictImpact('block-0', 'Test text.');
      expect(resonance.getImpact('block-0')).toBeDefined();
    });

    it('returns undefined for unknown block', () => {
      expect(resonance.getImpact('nonexistent')).toBeUndefined();
    });

    it('falls back to heuristic on inference failure', async () => {
      const failInfer = vi.fn().mockRejectedValue(new Error('fail'));
      const r = new EmotionalResonance({ inferFn: failInfer });

      const impact = await r.predictImpact(
        'block-0',
        'Test text with emotional content!'
      );
      expect(impact).toBeDefined();
      expect(impact.blockId).toBe('block-0');
    });
  });

  describe('analyzeArc', () => {
    it('analyzes emotional arc of the document', async () => {
      const arc = await resonance.analyzeArc(makeBlocks());
      expect(arc).toBeDefined();
      expect(arc.points.length).toBeGreaterThan(0);
      expect(arc.arcType).toBeTruthy();
    });

    it('stores arc for later retrieval', async () => {
      await resonance.analyzeArc(makeBlocks());
      expect(resonance.getArc()).not.toBeNull();
    });
  });

  describe('predictEditImpact', () => {
    it('predicts how an edit changes emotional landing', async () => {
      const result = await resonance.predictEditImpact(
        'block-0',
        'The situation was difficult.',
        'The situation was devastating.'
      );
      expect(result.before).toBeDefined();
      expect(result.after).toBeDefined();
      expect(typeof result.change).toBe('string');
    });
  });

  describe('visualization', () => {
    it('generates summary string', async () => {
      await resonance.predictImpact(
        'block-0',
        'Exciting news about breakthroughs!'
      );
      const summary = resonance.getSummary('block-0');
      expect(typeof summary).toBe('string');
    });

    it('returns neutral for unknown block summary', () => {
      const summary = resonance.getSummary('nonexistent');
      expect(typeof summary).toBe('string');
    });

    it('generates emotion color', async () => {
      await resonance.predictImpact('block-0', 'Happy content!');
      const color = resonance.getEmotionColor('block-0');
      expect(color).toMatch(/^hsl/);
    });

    it('returns neutral color for unknown block', () => {
      const color = resonance.getEmotionColor('nonexistent');
      expect(typeof color).toBe('string');
    });
  });

  describe('events', () => {
    it('emits change events on predict', async () => {
      let emitted = false;
      resonance.onChange(() => {
        emitted = true;
      });
      await resonance.predictImpact('block-0', 'Text.');
      expect(emitted).toBe(true);
    });

    it('supports unsubscribe', async () => {
      let count = 0;
      const unsub = resonance.onChange(() => {
        count++;
      });
      await resonance.predictImpact('block-0', 'Text.');
      expect(count).toBe(1);

      unsub();
      await resonance.predictImpact('block-1', 'Text.');
      expect(count).toBe(1);
    });
  });
});
