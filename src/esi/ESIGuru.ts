/**
 * ESIGuru — local documentation guidance from exhaust + reader context.
 *
 * This planner turns a large navigation tree into a smaller, progressive path:
 * start here, go here next, then dive deeper. It is intentionally local-only so
 * docs surfaces can use it without any paid inference dependency.
 */

export interface ESIGuruSidebarItem {
  readonly slug: string;
  readonly title: string;
  readonly category?: string | null;
  readonly parentSlug?: string | null;
  readonly sortOrder?: number;
  readonly viewerCount?: number;
}

export interface ESIGuruNavigationEvent {
  readonly slug: string;
  readonly previousSlug?: string;
  readonly timestamp: number;
  readonly dwellMs?: number;
}

export interface ESIGuruSemanticMatch {
  readonly slug: string;
  readonly score: number;
  readonly excerpt?: string;
}

export type ESIGuruExpertise = 'newcomer' | 'returning' | 'expert';

export interface ESIGuruUserContext {
  readonly currentSlug?: string;
  readonly currentCategory?: string | null;
  readonly query?: string;
  readonly goal?: string;
  readonly expertise?: ESIGuruExpertise;
  readonly preferredCategories?: readonly string[];
}

export interface ESIGuruInput {
  readonly sidebar: readonly ESIGuruSidebarItem[];
  readonly exhaust?: readonly ESIGuruNavigationEvent[];
  readonly semanticMatches?: readonly ESIGuruSemanticMatch[];
  readonly userContext?: ESIGuruUserContext;
  readonly maxSuggestions?: number;
  readonly assistantLabel?: string;
}

export type ESIGuruDepth = 'start' | 'next' | 'deep-dive';
export type ESIGuruMode = 'question' | 'journey';

export interface ESIGuruSuggestion {
  readonly slug: string;
  readonly title: string;
  readonly category: string;
  readonly score: number;
  readonly depth: ESIGuruDepth;
  readonly reason: string;
}

export interface ESIGuruGuide {
  readonly mode: ESIGuruMode;
  readonly summary: string;
  readonly focusCategory: string | null;
  readonly suggestions: readonly ESIGuruSuggestion[];
  readonly filteredSlugs: readonly string[];
  readonly relatedCategories: readonly string[];
  readonly followUpQuestion: string;
}

interface RankedSidebarItem {
  readonly page: ESIGuruSidebarItem;
  readonly category: string;
  readonly score: number;
  readonly overview: boolean;
  readonly apiLike: boolean;
  readonly specificity: number;
  readonly reasonParts: readonly string[];
}

const DEFAULT_MAX_SUGGESTIONS = 6;
const MAX_CONTEXT_EVENTS = 8;
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'do',
  'for',
  'from',
  'how',
  'i',
  'in',
  'is',
  'me',
  'my',
  'of',
  'on',
  'or',
  'the',
  'to',
  'use',
  'using',
  'what',
  'where',
  'with',
]);
const OVERVIEW_HINTS = new Set([
  'overview',
  'quickstart',
  'readme',
  'index',
  'getting',
  'started',
  'architecture',
  'guide',
  'guides',
]);
const API_HINTS = new Set([
  'api',
  'class',
  'classes',
  'cli',
  'function',
  'functions',
  'hook',
  'hooks',
  'interface',
  'interfaces',
  'method',
  'methods',
  'runtime',
  'type',
  'types',
]);

export function invokeESIGuru(input: ESIGuruInput): ESIGuruGuide {
  const sidebar = input.sidebar;
  const userContext = input.userContext;
  const currentSlug = userContext?.currentSlug;
  const currentCategory = normalizeCategory(userContext?.currentCategory);
  const assistantLabel = input.assistantLabel?.trim() || 'ESIGuru';
  const mode: ESIGuruMode = hasMeaningfulText(userContext?.query)
    ? 'question'
    : 'journey';

  if (sidebar.length === 0) {
    return {
      mode,
      summary:
        mode === 'question'
          ? 'Still loading the docs index\u2026'
          : `${assistantLabel} will have suggestions once the page index loads.`,
      focusCategory: currentCategory,
      suggestions: [],
      filteredSlugs: [],
      relatedCategories: [],
      followUpQuestion:
        mode === 'question'
          ? 'The docs index is still loading \u2014 try again in a moment.'
          : 'Start reading any page and suggestions will appear here.',
    };
  }

  const pagesBySlug = new Map(
    sidebar.map((page) => [page.slug, page] as const)
  );
  const currentPage = currentSlug ? pagesBySlug.get(currentSlug) : undefined;
  const queryTokens = tokenize(
    `${userContext?.query ?? ''} ${userContext?.goal ?? ''}`
  );
  const semanticScores = new Map<string, number>();
  for (const match of input.semanticMatches ?? []) {
    semanticScores.set(match.slug, clamp(match.score, 0, 1));
  }

  const recentEvents = [...(input.exhaust ?? [])].slice(-MAX_CONTEXT_EVENTS);
  const recentCategoryAffinity = buildRecentCategoryAffinity(
    recentEvents,
    pagesBySlug
  );
  const recentSlugAffinity = buildRecentSlugAffinity(recentEvents);
  const preferredCategories = new Set(
    (userContext?.preferredCategories ?? []).map((category) =>
      normalizeCategory(category)
    )
  );
  const expertise =
    userContext?.expertise ?? inferExpertise(sidebar, recentEvents);

  const ranked = sidebar
    .map((page) =>
      rankSidebarItem({
        page,
        currentPage,
        currentCategory,
        currentSlug,
        queryTokens,
        semanticScores,
        recentCategoryAffinity,
        recentSlugAffinity,
        preferredCategories,
        expertise,
      })
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.specificity - right.specificity ||
        left.page.title.localeCompare(right.page.title)
    );

  const positiveRanked = ranked.filter((item) => item.score > 0);
  const rankedPool = positiveRanked.length > 0 ? positiveRanked : ranked;
  const focusCategory = pickFocusCategory(
    rankedPool,
    currentPage,
    currentCategory,
    recentCategoryAffinity,
    mode
  );
  // During search, use the full ranked pool so results aren't locked to one category
  const rankedInFocus =
    focusCategory && mode === 'journey'
      ? rankedPool.filter((item) => item.category === focusCategory)
      : rankedPool;

  const suggestions = buildSuggestions(
    mode,
    rankedPool,
    rankedInFocus,
    focusCategory,
    input.maxSuggestions ?? DEFAULT_MAX_SUGGESTIONS
  );

  const filteredSlugs = collectFilteredSlugs(
    suggestions,
    rankedInFocus,
    currentSlug,
    input.maxSuggestions ?? DEFAULT_MAX_SUGGESTIONS
  );
  const relatedCategories = collectRelatedCategories(rankedPool, focusCategory);

  return {
    mode,
    summary: buildSummary(
      mode,
      focusCategory,
      userContext?.query,
      assistantLabel
    ),
    focusCategory,
    suggestions,
    filteredSlugs,
    relatedCategories,
    followUpQuestion: buildFollowUpQuestion(
      mode,
      focusCategory,
      assistantLabel
    ),
  };
}

export function invokeESIGuruFromProps(
  props: Record<string, unknown>
): ESIGuruGuide {
  return invokeESIGuru({
    sidebar: parseSidebarItems(props.sidebar),
    exhaust: parseNavigationEvents(props.exhaust),
    semanticMatches: parseSemanticMatches(props.semanticMatches),
    userContext: parseUserContext(props.userContext),
    maxSuggestions:
      typeof props.maxSuggestions === 'number'
        ? props.maxSuggestions
        : undefined,
    assistantLabel:
      typeof props.assistantLabel === 'string'
        ? props.assistantLabel
        : undefined,
  });
}

function rankSidebarItem(input: {
  page: ESIGuruSidebarItem;
  currentPage?: ESIGuruSidebarItem;
  currentCategory: string | null;
  currentSlug?: string;
  queryTokens: Set<string>;
  semanticScores: ReadonlyMap<string, number>;
  recentCategoryAffinity: ReadonlyMap<string, number>;
  recentSlugAffinity: ReadonlyMap<string, number>;
  preferredCategories: ReadonlySet<string>;
  expertise: ESIGuruExpertise;
}): RankedSidebarItem {
  const category = normalizeCategory(input.page.category);
  const titleTokens = tokenize(input.page.title);
  const slugTokens = tokenize(input.page.slug);
  const categoryTokens = tokenize(category ?? '');
  const overview = isOverviewLike(input.page, titleTokens, slugTokens);
  const apiLike = isApiLike(
    input.page,
    titleTokens,
    slugTokens,
    categoryTokens
  );

  let score = 0;
  const reasonParts: string[] = [];

  const titleMatches = countOverlap(input.queryTokens, titleTokens);
  if (titleMatches > 0) {
    score += titleMatches * 8;
    reasonParts.push('matches your search');
  }

  const slugMatches = countOverlap(input.queryTokens, slugTokens);
  if (slugMatches > 0) {
    score += slugMatches * 5;
    reasonParts.push('relevant to your query');
  }

  const categoryMatches = countOverlap(input.queryTokens, categoryTokens);
  if (categoryMatches > 0) {
    score += categoryMatches * 4;
    reasonParts.push('in a related section');
  }

  const semanticScore = input.semanticScores.get(input.page.slug) ?? 0;
  if (semanticScore > 0) {
    score += semanticScore * 10;
    reasonParts.push('strong content match');
  }

  const recentCategoryScore =
    input.recentCategoryAffinity.get(category ?? '') ?? 0;
  if (recentCategoryScore > 0) {
    score += recentCategoryScore;
    reasonParts.push('from your recent reading');
  }

  const recentSlugScore = input.recentSlugAffinity.get(input.page.slug) ?? 0;
  if (recentSlugScore > 0) {
    score += recentSlugScore * 0.5;
  }

  if (input.currentCategory && category === input.currentCategory) {
    // Light boost during search (tiebreaker), stronger during browsing
    score += input.queryTokens.size > 0 ? 1.5 : 5;
    if (input.queryTokens.size === 0) {
      reasonParts.push('in the same section');
    }
  }

  if (
    input.currentPage &&
    normalizeCategory(input.currentPage.category) === category &&
    input.currentPage.slug !== input.page.slug
  ) {
    const currentSort = input.currentPage.sortOrder ?? 0;
    const pageSort = input.page.sortOrder ?? 0;
    if (Math.abs(currentSort - pageSort) <= 2) {
      score += 2;
      reasonParts.push('next in sequence');
    }
  }

  if (input.preferredCategories.has(category ?? '')) {
    score += 4;
    reasonParts.push('in your preferred area');
  }

  if (overview) {
    if (input.expertise === 'newcomer') {
      score += 6;
      reasonParts.push('a great place to start');
    } else if (input.expertise === 'returning') {
      score += 3;
    } else {
      score += 1;
    }
  }

  if (apiLike) {
    if (input.expertise === 'expert') {
      score += 5;
      reasonParts.push('detailed reference material');
    } else if (input.expertise === 'newcomer') {
      score -= 2;
    }
  }

  if (input.page.viewerCount && input.page.viewerCount > 0) {
    score += Math.min(input.page.viewerCount, 5) * 0.35;
    reasonParts.push('popular with other readers');
  }

  if (input.currentSlug === input.page.slug) {
    score += input.queryTokens.size > 0 ? -1 : 2;
  }

  if (input.queryTokens.size === 0 && !overview && !apiLike) {
    score += 1;
  }

  return {
    page: input.page,
    category,
    score,
    overview,
    apiLike,
    specificity: input.page.slug.split('/').length,
    reasonParts: dedupeReasons(reasonParts),
  };
}

function buildSuggestions(
  mode: ESIGuruMode,
  rankedPool: readonly RankedSidebarItem[],
  rankedInFocus: readonly RankedSidebarItem[],
  focusCategory: string | null,
  maxSuggestions: number
): readonly ESIGuruSuggestion[] {
  const pool = rankedInFocus.length > 0 ? rankedInFocus : rankedPool;
  const chosen: RankedSidebarItem[] = [];

  const startCandidate =
    mode === 'question'
      ? pool[0]
      : pool.find((item) => item.overview) ??
        rankedPool.find(
          (item) => item.overview && item.category === focusCategory
        ) ??
        pool[0];
  if (startCandidate) {
    chosen.push(startCandidate);
  }

  const nextCandidate =
    (mode === 'question'
      ? pool.find(
          (item) =>
            item.overview &&
            !chosen.some(
              (chosenItem) => chosenItem.page.slug === item.page.slug
            )
        )
      : null) ??
    pool.find(
      (item) =>
        !chosen.some((chosenItem) => chosenItem.page.slug === item.page.slug)
    );
  if (nextCandidate) {
    chosen.push(nextCandidate);
  }

  const deepCandidate =
    (mode === 'question'
      ? pool.find(
          (item) =>
            item.apiLike &&
            !chosen.some(
              (chosenItem) => chosenItem.page.slug === item.page.slug
            )
        )
      : null) ??
    pool.find(
      (item) =>
        !item.overview &&
        !chosen.some((chosenItem) => chosenItem.page.slug === item.page.slug)
    ) ??
    rankedPool.find(
      (item) =>
        !chosen.some((chosenItem) => chosenItem.page.slug === item.page.slug)
    );
  if (deepCandidate) {
    chosen.push(deepCandidate);
  }

  for (const item of pool) {
    if (chosen.length >= maxSuggestions) {
      break;
    }
    if (chosen.some((chosenItem) => chosenItem.page.slug === item.page.slug)) {
      continue;
    }
    chosen.push(item);
  }

  return chosen.slice(0, maxSuggestions).map((item, index) => ({
    slug: item.page.slug,
    title: item.page.title,
    category: item.category ?? 'General',
    score: roundScore(item.score),
    depth: index === 0 ? 'start' : index === 1 ? 'next' : 'deep-dive',
    reason: formatReason(item.reasonParts, index),
  }));
}

function collectFilteredSlugs(
  suggestions: readonly ESIGuruSuggestion[],
  rankedInFocus: readonly RankedSidebarItem[],
  currentSlug: string | undefined,
  maxSuggestions: number
): readonly string[] {
  const focused = rankedInFocus
    .slice(0, Math.max(maxSuggestions + 3, 8))
    .map((item) => item.page.slug);

  return uniqueStrings([
    ...suggestions.map((suggestion) => suggestion.slug),
    ...focused,
    ...(currentSlug ? [currentSlug] : []),
  ]);
}

function collectRelatedCategories(
  rankedPool: readonly RankedSidebarItem[],
  focusCategory: string | null
): readonly string[] {
  const categoryScores = new Map<string, number>();
  for (const item of rankedPool) {
    const existing = categoryScores.get(item.category ?? 'General') ?? 0;
    categoryScores.set(item.category ?? 'General', existing + item.score);
  }

  return [...categoryScores.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([category]) => category)
    .filter((category) => category !== focusCategory)
    .slice(0, 3);
}

function pickFocusCategory(
  rankedPool: readonly RankedSidebarItem[],
  currentPage: ESIGuruSidebarItem | undefined,
  currentCategory: string | null,
  recentCategoryAffinity: ReadonlyMap<string, number>,
  mode: ESIGuruMode = 'journey'
): string | null {
  if (rankedPool.length === 0) {
    return currentCategory;
  }

  const categoryScores = new Map<string, number>();
  for (const item of rankedPool) {
    const existing = categoryScores.get(item.category ?? 'General') ?? 0;
    categoryScores.set(item.category ?? 'General', existing + item.score);
  }

  // Current page category is a signal — strong when browsing, light when searching
  if (currentPage) {
    const pageCategory = normalizeCategory(currentPage.category);
    if (pageCategory) {
      const boost = mode === 'question' ? 1 : 4;
      categoryScores.set(
        pageCategory,
        (categoryScores.get(pageCategory) ?? 0) + boost
      );
    }
  }

  for (const [category, boost] of recentCategoryAffinity) {
    // Reduce recency bias during search
    const weight = mode === 'question' ? 0.15 : 0.5;
    categoryScores.set(
      category,
      (categoryScores.get(category) ?? 0) + boost * weight
    );
  }

  const rankedCategory = [...categoryScores.entries()].sort(
    (left, right) => right[1] - left[1]
  )[0]?.[0];

  return rankedCategory ?? currentCategory;
}

function buildSummary(
  mode: ESIGuruMode,
  focusCategory: string | null,
  query: string | undefined,
  assistantLabel: string
): string {
  const friendly = humanizeCategory(focusCategory);

  if (mode === 'question' && hasMeaningfulText(query)) {
    return `Searching all docs for \u201c${query?.trim()}\u201d`;
  }

  return friendly
    ? `${assistantLabel} picked these from ${friendly} based on your recent reading.`
    : `${assistantLabel} picked these based on your recent reading.`;
}

function buildFollowUpQuestion(
  mode: ESIGuruMode,
  focusCategory: string | null,
  assistantLabel: string
): string {
  const friendly = humanizeCategory(focusCategory);

  if (mode === 'question') {
    return 'Try refining your search or ask a different question.';
  }

  return friendly ? `Ask me anything about ${friendly}.` : 'Ask me anything.';
}

function humanizeCategory(category: string | null): string | null {
  if (!category || category === 'General') {
    return null;
  }

  if (category.toLowerCase().startsWith('ebooks/')) {
    const parts = category.split('/');
    const ebookSlug = parts[1];
    if (ebookSlug) {
      const words = ebookSlug
        .replace(/^\d+-/u, '')
        .replace(/-/gu, ' ')
        .split(' ')
        .filter(Boolean);
      // Sentence case: capitalize first word, leave rest lowercase
      // except known acronyms
      const ACRONYMS = new Set([
        'ai',
        'api',
        'cpu',
        'gpu',
        'llm',
        'os',
        'tts',
        'stt',
        'ui',
        'vl',
        'wasm',
        'zk',
      ]);
      const humanized = words
        .map((w, i) => {
          const lower = w.toLowerCase();
          if (ACRONYMS.has(lower)) return lower.toUpperCase();
          if (i === 0) return lower.charAt(0).toUpperCase() + lower.slice(1);
          return lower;
        })
        .join(' ');
      // Truncate if too long
      if (humanized.length > 40) {
        const truncated = humanized.slice(0, 37).replace(/\s+\S*$/, '');
        return `\u201c${truncated}\u2026\u201d`;
      }
      return `\u201c${humanized}\u201d`;
    }
    return 'the library';
  }

  if (category === 'Ebooks') {
    return 'the library';
  }

  if (category === 'Technical Binder') {
    return 'the Technical Binder';
  }

  if (category === 'API Reference') {
    return 'the API Reference';
  }

  if (category.endsWith(' API')) {
    return `the ${category}`;
  }

  return category;
}

function buildRecentCategoryAffinity(
  events: readonly ESIGuruNavigationEvent[],
  pagesBySlug: ReadonlyMap<string, ESIGuruSidebarItem>
): ReadonlyMap<string, number> {
  const affinity = new Map<string, number>();
  const recent = [...events].slice(-MAX_CONTEXT_EVENTS).reverse();

  for (const [index, event] of recent.entries()) {
    const page = pagesBySlug.get(event.slug);
    if (!page) {
      continue;
    }
    const category = normalizeCategory(page.category);
    if (!category) {
      continue;
    }
    const recencyBoost = Math.max(MAX_CONTEXT_EVENTS - index, 1);
    const dwellBoost = clamp((event.dwellMs ?? 0) / 30000, 0, 4);
    const nextValue = (affinity.get(category) ?? 0) + recencyBoost + dwellBoost;
    affinity.set(category, nextValue);
  }

  return affinity;
}

function buildRecentSlugAffinity(
  events: readonly ESIGuruNavigationEvent[]
): ReadonlyMap<string, number> {
  const affinity = new Map<string, number>();
  const recent = [...events].slice(-MAX_CONTEXT_EVENTS).reverse();

  for (const [index, event] of recent.entries()) {
    const recencyBoost = Math.max(MAX_CONTEXT_EVENTS - index, 1);
    affinity.set(event.slug, (affinity.get(event.slug) ?? 0) + recencyBoost);
  }

  return affinity;
}

function inferExpertise(
  sidebar: readonly ESIGuruSidebarItem[],
  recentEvents: readonly ESIGuruNavigationEvent[]
): ESIGuruExpertise {
  if (recentEvents.length <= 2) {
    return 'newcomer';
  }

  const pagesBySlug = new Map(
    sidebar.map((page) => [page.slug, page] as const)
  );
  const apiVisits = recentEvents.filter((event) => {
    const page = pagesBySlug.get(event.slug);
    if (!page) {
      return false;
    }
    return isApiLike(
      page,
      tokenize(page.title),
      tokenize(page.slug),
      tokenize(page.category ?? '')
    );
  }).length;

  if (apiVisits >= Math.ceil(recentEvents.length / 2)) {
    return 'expert';
  }

  return 'returning';
}

function isOverviewLike(
  page: ESIGuruSidebarItem,
  titleTokens: Set<string>,
  slugTokens: Set<string>
): boolean {
  if (page.slug.endsWith('/README') || page.slug.endsWith('/index')) {
    return true;
  }

  for (const token of [...titleTokens, ...slugTokens]) {
    if (OVERVIEW_HINTS.has(token)) {
      return true;
    }
  }

  return false;
}

function isApiLike(
  page: ESIGuruSidebarItem,
  titleTokens: Set<string>,
  slugTokens: Set<string>,
  categoryTokens: Set<string>
): boolean {
  if (page.slug.includes('/api/')) {
    return true;
  }

  for (const token of [...titleTokens, ...slugTokens, ...categoryTokens]) {
    if (API_HINTS.has(token)) {
      return true;
    }
  }

  return false;
}

function tokenize(value: string): Set<string> {
  const tokens = value
    .toLowerCase()
    .replace(/[_/.-]+/g, ' ')
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
  return new Set(tokens);
}

function countOverlap(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>
): number {
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) {
      overlap++;
    }
  }
  return overlap;
}

function normalizeCategory(category: string | null | undefined): string {
  const trimmed = category?.trim();
  return trimmed ? trimmed : 'General';
}

function dedupeReasons(reasonParts: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const reason of reasonParts) {
    if (seen.has(reason)) {
      continue;
    }
    seen.add(reason);
    deduped.push(reason);
  }

  return deduped;
}

function formatReason(reasonParts: readonly string[], index: number): string {
  if (reasonParts.length === 0) {
    return index === 0 ? 'recommended starting point' : 'suggested next';
  }

  return reasonParts.slice(0, 2).join(' \u00b7 ');
}

function roundScore(score: number): number {
  return Math.round(score * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const next: string[] = [];

  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    next.push(value);
  }

  return next;
}

function hasMeaningfulText(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

function parseSidebarItems(value: unknown): readonly ESIGuruSidebarItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.slug !== 'string' ||
      typeof entry.title !== 'string'
    ) {
      return [];
    }

    return [
      {
        slug: entry.slug,
        title: entry.title,
        category: typeof entry.category === 'string' ? entry.category : null,
        parentSlug:
          typeof entry.parentSlug === 'string' ? entry.parentSlug : null,
        sortOrder:
          typeof entry.sortOrder === 'number' ? entry.sortOrder : undefined,
        viewerCount:
          typeof entry.viewerCount === 'number' ? entry.viewerCount : undefined,
      },
    ];
  });
}

function parseNavigationEvents(
  value: unknown
): readonly ESIGuruNavigationEvent[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.slug !== 'string') {
      return [];
    }

    return [
      {
        slug: entry.slug,
        previousSlug:
          typeof entry.previousSlug === 'string'
            ? entry.previousSlug
            : undefined,
        timestamp:
          typeof entry.timestamp === 'number' ? entry.timestamp : Date.now(),
        dwellMs: typeof entry.dwellMs === 'number' ? entry.dwellMs : undefined,
      },
    ];
  });
}

function parseSemanticMatches(
  value: unknown
): readonly ESIGuruSemanticMatch[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.flatMap((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.slug !== 'string' ||
      typeof entry.score !== 'number'
    ) {
      return [];
    }

    return [
      {
        slug: entry.slug,
        score: entry.score,
        excerpt: typeof entry.excerpt === 'string' ? entry.excerpt : undefined,
      },
    ];
  });
}

function parseUserContext(value: unknown): ESIGuruUserContext | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    currentSlug:
      typeof value.currentSlug === 'string' ? value.currentSlug : undefined,
    currentCategory:
      typeof value.currentCategory === 'string' ? value.currentCategory : null,
    query: typeof value.query === 'string' ? value.query : undefined,
    goal: typeof value.goal === 'string' ? value.goal : undefined,
    expertise:
      value.expertise === 'newcomer' ||
      value.expertise === 'returning' ||
      value.expertise === 'expert'
        ? value.expertise
        : undefined,
    preferredCategories: Array.isArray(value.preferredCategories)
      ? value.preferredCategories.filter(
          (category): category is string => typeof category === 'string'
        )
      : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// Re-export IntentClassifier for docs-app convenience
export {
  classifyIntentLocal,
  classifyIntentRemote,
  composeExhaustText,
  buildIntentSignal,
  type IntentLabel,
  type IntentClassification,
  type IntentSignal,
} from './IntentClassifier';
