/**
 * DocumentOracle — The document that understands itself
 *
 * NOBODY HAS BUILT THIS.
 *
 * Every editor is dumb about its own content. You write;
 * the editor renders. It never says: "this paragraph
 * contradicts paragraph 12" or "your argument peaks at
 * section 3 and the conclusion doesn't land."
 *
 * The oracle uses embeddings + inference to generate
 * structural self-awareness:
 *   - Argument gap detection
 *   - Contradiction discovery
 *   - Strength mapping (which sections are weak?)
 *   - Audience prediction (who will read this, and will they get it?)
 *   - Structural suggestions (reorder sections for impact)
 *   - Question generation (what will readers ask that you didn't answer?)
 */

// ── Types ───────────────────────────────────────────────────────────

export type OracleInsightType =
  | 'contradiction'
  | 'gap'
  | 'weak-section'
  | 'strong-section'
  | 'redundancy'
  | 'unanswered-question'
  | 'audience-mismatch'
  | 'structural-suggestion'
  | 'tone-shift'
  | 'unsupported-claim';

export interface OracleInsight {
  /** Insight ID */
  readonly id: string;
  /** Insight type */
  readonly type: OracleInsightType;
  /** Severity: how important is this for the author to address? (0-1) */
  readonly severity: number;
  /** Human-readable summary of the insight */
  readonly summary: string;
  /** Detailed explanation */
  readonly detail: string;
  /** Block IDs involved */
  readonly blockIds: string[];
  /** Suggested action */
  readonly suggestion?: string;
  /** Confidence in this insight (0-1) */
  readonly confidence: number;
  /** Whether the author has dismissed this */
  dismissed: boolean;
}

export interface DocumentProfile {
  /** Overall document quality score (0-1) */
  readonly qualityScore: number;
  /** Argument coherence (0-1) */
  readonly coherence: number;
  /** Reading level (Flesch-Kincaid grade) */
  readonly readingLevel: number;
  /** Estimated audience */
  readonly audience: string;
  /** Primary tone */
  readonly tone: string;
  /** Key claims made */
  readonly claims: string[];
  /** Questions the document raises but doesn't answer */
  readonly unansweredQuestions: string[];
  /** Overall assessment */
  readonly assessment: string;
}

export interface OracleConfig {
  /** Inference function (sends prompt, gets response) */
  readonly inferFn: (prompt: string) => Promise<string>;
  /** Minimum severity threshold for surfacing insights (default: 0.3) */
  readonly severityThreshold?: number;
  /** Maximum insights to show at once (default: 5) */
  readonly maxInsights?: number;
}

// ── Document Oracle Engine ──────────────────────────────────────────

export class DocumentOracle {
  private config: Required<OracleConfig>;
  private insights: Map<string, OracleInsight> = new Map();
  private profile: DocumentProfile | null = null;
  private listeners: Set<(insights: OracleInsight[]) => void> = new Set();

  constructor(config: OracleConfig) {
    this.config = {
      inferFn: config.inferFn,
      severityThreshold: config.severityThreshold ?? 0.3,
      maxInsights: config.maxInsights ?? 5,
    };
  }

  /**
   * Run a full oracle analysis on the document.
   * Returns structural insights about the document's own content.
   */
  async analyze(
    blocks: Array<{
      id: string;
      text: string;
      blockType: string;
      embedding?: Float32Array;
      sentiment?: number;
    }>
  ): Promise<OracleInsight[]> {
    const insights: OracleInsight[] = [];

    // Run analyses in parallel
    const [contradictions, gaps, weaknesses, questions, toneShifts] =
      await Promise.all([
        this.findContradictions(blocks),
        this.findArgumentGaps(blocks),
        this.findWeakSections(blocks),
        this.findUnansweredQuestions(blocks),
        this.findToneShifts(blocks),
      ]);

    insights.push(
      ...contradictions,
      ...gaps,
      ...weaknesses,
      ...questions,
      ...toneShifts
    );

    // Also detect redundancy via embedding similarity
    const redundancies = this.findRedundancies(blocks);
    insights.push(...redundancies);

    // Filter by severity threshold
    const filtered = insights
      .filter((i) => i.severity >= this.config.severityThreshold)
      .sort((a, b) => b.severity - a.severity)
      .slice(0, this.config.maxInsights);

    // Store
    this.insights.clear();
    for (const insight of filtered) {
      this.insights.set(insight.id, insight);
    }

    this.notify();
    return filtered;
  }

  /**
   * Build a high-level profile of the document.
   */
  async buildProfile(
    blocks: Array<{ text: string; blockType: string; sentiment?: number }>
  ): Promise<DocumentProfile> {
    const fullText = blocks.map((b) => b.text).join('\n\n');
    const truncated = fullText.slice(0, 4000); // context window safety

    const response = await this.config.inferFn(
      `Analyze this document and respond in JSON with these fields:
      qualityScore (0-1), coherence (0-1), readingLevel (Flesch-Kincaid grade number),
      audience (short description), tone (one word), claims (array of key claims, max 5),
      unansweredQuestions (array of questions raised but not answered, max 5),
      assessment (2-3 sentence overall assessment).

      Document:
      ${truncated}`
    );

    try {
      this.profile = JSON.parse(response);
      return this.profile!;
    } catch {
      // Fallback if inference doesn't return valid JSON
      this.profile = {
        qualityScore: 0.5,
        coherence: 0.5,
        readingLevel: 10,
        audience: 'General',
        tone: 'neutral',
        claims: [],
        unansweredQuestions: [],
        assessment: response.slice(0, 200),
      };
      return this.profile;
    }
  }

  /**
   * Ask the document a specific question about itself.
   */
  async ask(
    question: string,
    blocks: Array<{ id: string; text: string }>
  ): Promise<{ answer: string; relevantBlockIds: string[] }> {
    const fullText = blocks
      .map((b) => `[Block ${b.id}]: ${b.text}`)
      .join('\n\n');
    const truncated = fullText.slice(0, 4000);

    const response = await this.config.inferFn(
      `You are the oracle of a document. Answer this question about the document itself.
      Respond in JSON: { "answer": "...", "relevantBlockIds": ["..."] }

      Question: ${question}

      Document:
      ${truncated}`
    );

    try {
      return JSON.parse(response);
    } catch {
      return { answer: response, relevantBlockIds: [] };
    }
  }

  /**
   * Get current insights.
   */
  getInsights(): OracleInsight[] {
    return Array.from(this.insights.values()).filter((i) => !i.dismissed);
  }

  /**
   * Dismiss an insight.
   */
  dismiss(insightId: string): void {
    const insight = this.insights.get(insightId);
    if (insight) {
      insight.dismissed = true;
      this.notify();
    }
  }

  /**
   * Get the document profile.
   */
  getProfile(): DocumentProfile | null {
    return this.profile;
  }

  /**
   * Listen for insight changes.
   */
  onChange(listener: (insights: OracleInsight[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── Private: Analysis Methods ─────────────────────────────────

  private async findContradictions(
    blocks: Array<{ id: string; text: string; embedding?: Float32Array }>
  ): Promise<OracleInsight[]> {
    // Strategy: find block pairs with high similarity but opposing sentiment/claims
    const pairs: Array<[number, number, number]> = [];

    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        if (blocks[i].embedding && blocks[j].embedding) {
          const sim = this.cosine(blocks[i].embedding!, blocks[j].embedding!);
          if (sim > 0.6 && sim < 0.9) {
            // High similarity but not identical — potential contradiction
            pairs.push([i, j, sim]);
          }
        }
      }
    }

    if (pairs.length === 0) return [];

    // Use inference to check top candidates
    const topPairs = pairs.sort((a, b) => b[2] - a[2]).slice(0, 3);
    const insights: OracleInsight[] = [];

    for (const [i, j] of topPairs) {
      const response = await this.config.inferFn(
        `Do these two passages contradict each other? Reply with JSON: { "contradicts": boolean, "explanation": string }

        Passage A: ${blocks[i].text.slice(0, 500)}
        Passage B: ${blocks[j].text.slice(0, 500)}`
      );

      try {
        const result = JSON.parse(response);
        if (result.contradicts) {
          insights.push({
            id: `contra-${i}-${j}`,
            type: 'contradiction',
            severity: 0.8,
            summary: `Contradiction detected between two sections`,
            detail: result.explanation,
            blockIds: [blocks[i].id, blocks[j].id],
            suggestion:
              'Resolve the contradiction by clarifying or removing one of the conflicting statements.',
            confidence: 0.7,
            dismissed: false,
          });
        }
      } catch {
        /* inference returned non-JSON */
      }
    }

    return insights;
  }

  private async findArgumentGaps(
    blocks: Array<{ id: string; text: string; blockType: string }>
  ): Promise<OracleInsight[]> {
    const text = blocks
      .map((b) => b.text)
      .join('\n\n')
      .slice(0, 3000);

    const response = await this.config.inferFn(
      `Analyze this document for argument gaps — places where a claim is made but not supported,
      or where a logical step is missing. Respond in JSON:
      [{ "gap": string, "afterBlockIndex": number, "severity": number (0-1) }]
      Max 3 gaps.

      Document:
      ${text}`
    );

    try {
      const gaps: Array<{
        gap: string;
        afterBlockIndex: number;
        severity: number;
      }> = JSON.parse(response);
      return gaps.map((g, i) => ({
        id: `gap-${i}`,
        type: 'gap' as const,
        severity: g.severity,
        summary: `Argument gap: ${g.gap}`,
        detail: g.gap,
        blockIds: blocks[g.afterBlockIndex]
          ? [blocks[g.afterBlockIndex].id]
          : [],
        suggestion: `Add a paragraph after this section that addresses: ${g.gap}`,
        confidence: 0.6,
        dismissed: false,
      }));
    } catch {
      return [];
    }
  }

  private async findWeakSections(
    blocks: Array<{ id: string; text: string; blockType: string }>
  ): Promise<OracleInsight[]> {
    const text = blocks
      .map((b, i) => `[${i}] ${b.text}`)
      .join('\n\n')
      .slice(0, 3000);

    const response = await this.config.inferFn(
      `Identify the weakest section of this document — the part that is least convincing,
      least clear, or would benefit most from rewriting.
      Respond in JSON: { "index": number, "reason": string, "severity": number (0-1) }

      Document:
      ${text}`
    );

    try {
      const result = JSON.parse(response);
      if (blocks[result.index]) {
        return [
          {
            id: `weak-${result.index}`,
            type: 'weak-section',
            severity: result.severity,
            summary: `Weak section identified`,
            detail: result.reason,
            blockIds: [blocks[result.index].id],
            suggestion: `Consider strengthening this section: ${result.reason}`,
            confidence: 0.5,
            dismissed: false,
          },
        ];
      }
    } catch {
      /* ignore */
    }
    return [];
  }

  private async findUnansweredQuestions(
    blocks: Array<{ id: string; text: string }>
  ): Promise<OracleInsight[]> {
    const text = blocks
      .map((b) => b.text)
      .join('\n\n')
      .slice(0, 3000);

    const response = await this.config.inferFn(
      `What are the top 3 questions a reader would have after reading this document
      that the document does NOT answer? Respond in JSON:
      [{ "question": string, "relatedBlockIndex": number }]

      Document:
      ${text}`
    );

    try {
      const questions: Array<{ question: string; relatedBlockIndex: number }> =
        JSON.parse(response);
      return questions.map((q, i) => ({
        id: `unanswered-${i}`,
        type: 'unanswered-question' as const,
        severity: 0.5,
        summary: q.question,
        detail: `Readers will likely ask: "${q.question}"`,
        blockIds: blocks[q.relatedBlockIndex]
          ? [blocks[q.relatedBlockIndex].id]
          : [],
        suggestion: `Address this question in or after the relevant section.`,
        confidence: 0.6,
        dismissed: false,
      }));
    } catch {
      return [];
    }
  }

  private async findToneShifts(
    blocks: Array<{ id: string; text: string; sentiment?: number }>
  ): Promise<OracleInsight[]> {
    const insights: OracleInsight[] = [];

    for (let i = 1; i < blocks.length; i++) {
      const prevSentiment = blocks[i - 1].sentiment ?? 0;
      const currSentiment = blocks[i].sentiment ?? 0;
      const shift = Math.abs(currSentiment - prevSentiment);

      if (shift > 0.5) {
        insights.push({
          id: `tone-${i}`,
          type: 'tone-shift',
          severity: shift * 0.8,
          summary: `Jarring tone shift between sections`,
          detail: `Sentiment jumps from ${prevSentiment.toFixed(
            2
          )} to ${currSentiment.toFixed(2)} — a ${
            shift > 0.7 ? 'dramatic' : 'noticeable'
          } shift that may disorient readers.`,
          blockIds: [blocks[i - 1].id, blocks[i].id],
          suggestion:
            'Add a transitional sentence or adjust tone for smoother flow.',
          confidence: 0.8,
          dismissed: false,
        });
      }
    }

    return insights.sort((a, b) => b.severity - a.severity).slice(0, 2);
  }

  private findRedundancies(
    blocks: Array<{ id: string; text: string; embedding?: Float32Array }>
  ): OracleInsight[] {
    const insights: OracleInsight[] = [];

    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 2; j < blocks.length; j++) {
        // skip adjacent
        if (blocks[i].embedding && blocks[j].embedding) {
          const sim = this.cosine(blocks[i].embedding!, blocks[j].embedding!);
          if (sim > 0.9) {
            insights.push({
              id: `redundant-${i}-${j}`,
              type: 'redundancy',
              severity: 0.6,
              summary: `Near-duplicate content detected`,
              detail: `These two sections say essentially the same thing (${(
                sim * 100
              ).toFixed(0)}% similarity).`,
              blockIds: [blocks[i].id, blocks[j].id],
              suggestion: 'Merge these sections or remove the duplication.',
              confidence: sim,
              dismissed: false,
            });
          }
        }
      }
    }

    return insights.slice(0, 2);
  }

  private cosine(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;
    let dot = 0,
      magA = 0,
      magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }

  private notify(): void {
    const insights = this.getInsights();
    for (const listener of this.listeners) listener(insights);
  }
}
