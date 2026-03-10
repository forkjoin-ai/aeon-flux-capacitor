/**
 * IntentClassifier — maps navigation exhaust to search intent labels.
 *
 * Uses the dejanseo/Intent-XS label space:
 *   Informational — user wants to learn / understand
 *   Navigational  — user wants to reach a specific page
 *   Commercial    — user is comparing / evaluating options
 *   Transactional — user wants to do / build / implement something
 *
 * Two inference paths:
 *   1. Remote — POST to edge /ai/infer with model intent-xs (Cloud Run BERT)
 *   2. Local  — heuristic fallback from exhaust patterns alone (zero latency)
 */

import type { ESIGuruNavigationEvent } from './ESIGuru';

// ── Public types ─────────────────────────────────────────────────────────────

export type IntentLabel =
  | 'Informational'
  | 'Navigational'
  | 'Commercial'
  | 'Transactional';

export interface IntentClassification {
  readonly label: IntentLabel;
  readonly score: number;
}

export interface IntentSignal {
  readonly classifications: readonly IntentClassification[];
  readonly source: 'remote' | 'local';
  readonly preferredCategories: readonly string[];
  readonly goal: string;
}

// ── Intent → doc category mapping ────────────────────────────────────────────

interface IntentDocStrategy {
  readonly preferredCategories: readonly string[];
  readonly goal: string;
  readonly boostOverview: boolean;
  readonly boostApi: boolean;
}

const INTENT_STRATEGIES: Record<IntentLabel, IntentDocStrategy> = {
  Informational: {
    preferredCategories: ['guides', 'getting-started', 'packages', 'wasm'],
    goal: 'learn how something works',
    boostOverview: true,
    boostApi: false,
  },
  Navigational: {
    preferredCategories: [],
    goal: 'find a specific page',
    boostOverview: false,
    boostApi: false,
  },
  Commercial: {
    preferredCategories: ['products', 'packages', 'shared'],
    goal: 'compare or evaluate options',
    boostOverview: true,
    boostApi: false,
  },
  Transactional: {
    preferredCategories: ['api', 'packages', 'wasm', 'guides'],
    goal: 'build or implement something',
    boostOverview: false,
    boostApi: true,
  },
};

// ── Remote classification via edge worker ────────────────────────────────────

export async function classifyIntentRemote(
  text: string,
  edgeEndpoint = '/ai/infer'
): Promise<IntentClassification[] | null> {
  try {
    const response = await fetch(edgeEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modality: 'text-classify',
        model: 'intent-xs',
        text,
        task: 'intent-classification',
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      classifications?: Array<{ label: string; score: number }>;
    };

    if (!Array.isArray(data.classifications)) {
      return null;
    }

    return data.classifications
      .filter(
        (c): c is { label: IntentLabel; score: number } =>
          isIntentLabel(c.label) && typeof c.score === 'number'
      )
      .sort((a, b) => b.score - a.score);
  } catch {
    return null;
  }
}

// ── Local heuristic classification from exhaust patterns ─────────────────────

export function classifyIntentLocal(
  exhaust: readonly ESIGuruNavigationEvent[],
  currentSlug: string,
  query?: string
): IntentClassification[] {
  const scores: Record<IntentLabel, number> = {
    Informational: 0.25,
    Navigational: 0.25,
    Commercial: 0.25,
    Transactional: 0.25,
  };

  const recent = exhaust.slice(-8);
  const slugs = recent.map((e) => e.slug);

  // Query presence strongly signals Navigational or Informational
  if (query && query.trim().length > 0) {
    const q = query.toLowerCase();
    if (q.startsWith('how') || q.includes('what is') || q.includes('explain')) {
      scores.Informational += 0.4;
    } else if (
      q.includes('find') ||
      q.includes('where') ||
      q.includes('go to')
    ) {
      scores.Navigational += 0.4;
    } else if (
      q.includes('compare') ||
      q.includes('vs') ||
      q.includes('which')
    ) {
      scores.Commercial += 0.4;
    } else if (
      q.includes('implement') ||
      q.includes('build') ||
      q.includes('create') ||
      q.includes('setup') ||
      q.includes('install')
    ) {
      scores.Transactional += 0.4;
    } else {
      // Generic query → slight Informational bias
      scores.Informational += 0.15;
      scores.Navigational += 0.1;
    }
  }

  // Slug pattern signals
  const apiVisits = slugs.filter(
    (s) => s.includes('/api/') || s.includes('function') || s.includes('hook')
  ).length;
  const guideVisits = slugs.filter(
    (s) =>
      s.includes('getting-started') ||
      s.includes('guide') ||
      s.includes('overview')
  ).length;
  const productVisits = slugs.filter(
    (s) => s.includes('products/') || s.includes('packages/')
  ).length;

  if (apiVisits >= 3) {
    scores.Transactional += 0.3;
  } else if (apiVisits >= 1) {
    scores.Transactional += 0.15;
  }

  if (guideVisits >= 2) {
    scores.Informational += 0.25;
  }

  if (productVisits >= 2) {
    scores.Commercial += 0.3;
  }

  // Quick transitions → scanning → Navigational
  const quickTransitions = recent.filter(
    (e) => typeof e.dwellMs === 'number' && e.dwellMs <= 5000
  ).length;
  if (quickTransitions >= 3) {
    scores.Navigational += 0.2;
  }

  // Long dwell on guides → Informational
  const longDwells = recent.filter(
    (e) => typeof e.dwellMs === 'number' && e.dwellMs >= 30000
  ).length;
  if (longDwells >= 2) {
    scores.Informational += 0.2;
  }

  // Revisiting same pages → lost → Navigational
  const uniqueSlugs = new Set(slugs);
  if (slugs.length >= 4 && uniqueSlugs.size <= slugs.length / 2) {
    scores.Navigational += 0.2;
  }

  // Current slug context
  if (currentSlug.includes('/api/')) {
    scores.Transactional += 0.1;
  }
  if (
    currentSlug.includes('getting-started') ||
    currentSlug.includes('overview')
  ) {
    scores.Informational += 0.1;
  }
  if (currentSlug.includes('products/')) {
    scores.Commercial += 0.1;
  }

  // Normalize via softmax
  const entries = Object.entries(scores) as [IntentLabel, number][];
  const maxScore = Math.max(...entries.map(([, s]) => s));
  const expScores = entries.map(
    ([label, s]) => [label, Math.exp(s - maxScore)] as const
  );
  const sumExp = expScores.reduce((acc, [, e]) => acc + e, 0);

  return expScores
    .map(([label, e]) => ({
      label,
      score: Math.round((e / sumExp) * 10000) / 10000,
    }))
    .sort((a, b) => b.score - a.score);
}

// ── Compose exhaust into classifiable text ────────────────────────────────────

export function composeExhaustText(
  exhaust: readonly ESIGuruNavigationEvent[],
  currentSlug: string,
  query?: string
): string {
  const recentSlugs = exhaust
    .slice(-5)
    .map((e) => e.slug.replace(/[/\-_]/g, ' ').trim())
    .filter((s) => s.length > 0);

  const parts: string[] = [];

  if (recentSlugs.length > 0) {
    parts.push(`browsing ${recentSlugs.join(', ')}`);
  }

  if (query && query.trim().length > 0) {
    parts.push(`searching for ${query.trim()}`);
  }

  parts.push(
    `currently at ${currentSlug.replace(/[/\-_]/g, ' ').trim() || 'home'}`
  );

  return parts.join(' ');
}

// ── Build full intent signal (local + optional remote) ───────────────────────

export function buildIntentSignal(
  classifications: readonly IntentClassification[],
  source: 'remote' | 'local'
): IntentSignal {
  const topLabel =
    classifications.length > 0 ? classifications[0].label : 'Informational';
  const strategy = INTENT_STRATEGIES[topLabel];

  return {
    classifications,
    source,
    preferredCategories: strategy.preferredCategories,
    goal: strategy.goal,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const INTENT_LABELS = new Set<string>([
  'Informational',
  'Navigational',
  'Commercial',
  'Transactional',
]);

function isIntentLabel(value: string): value is IntentLabel {
  return INTENT_LABELS.has(value);
}
