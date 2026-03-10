/**
 * GhostSuggest — Block-level autocomplete from inference
 *
 * Watches the cursor position and surrounding blocks,
 * uses their embeddings + semantic graph to predict the
 * next block. Shows a ghost preview. Tab to accept.
 *
 * Like Copilot but for writing — full paragraphs,
 * headings, code blocks, whatever the embeddings suggest.
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';

// ── Types ───────────────────────────────────────────────────────────

export interface GhostSuggestion {
  /** Unique suggestion ID */
  readonly id: string;
  /** The suggested text */
  readonly text: string;
  /** Suggested block type */
  readonly blockType: 'paragraph' | 'heading' | 'code' | 'list' | 'blockquote';
  /** Confidence (0-1) */
  readonly confidence: number;
  /** Where this suggestion appears (after which block) */
  readonly afterBlockId: string;
  /** Source: what informed this suggestion */
  readonly source: 'continuation' | 'semantic' | 'voice' | 'template';
}

export interface GhostSuggestConfig {
  /** Inference function — takes context, returns suggested text */
  readonly infer: (context: InferenceContext) => Promise<string>;
  /** Debounce delay in ms before requesting a suggestion */
  readonly debounceMs?: number;
  /** Minimum characters typed before triggering */
  readonly minChars?: number;
  /** Maximum number of context blocks to send */
  readonly maxContextBlocks?: number;
  /** Whether to include embeddings in context */
  readonly includeEmbeddings?: boolean;
  /** Voice model ID to constrain generation */
  readonly voiceModelId?: string;
}

export interface InferenceContext {
  /** The blocks leading up to the cursor */
  readonly precedingBlocks: Array<{
    text: string;
    blockType: string;
    embedding?: Float32Array;
  }>;
  /** The current (potentially partial) block text */
  readonly currentText: string;
  /** The blocks after the cursor */
  readonly followingBlocks: Array<{
    text: string;
    blockType: string;
  }>;
  /** Document-level metadata */
  readonly documentMeta: {
    title?: string;
    totalBlocks: number;
    cursorPosition: number;
  };
  /** Voice model constraint */
  readonly voiceModelId?: string;
}

// ── Ghost Suggest Engine ────────────────────────────────────────────

export class GhostSuggestEngine {
  private config: GhostSuggestConfig;
  private currentSuggestion: GhostSuggestion | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;
  private listeners: Set<(suggestion: GhostSuggestion | null) => void> =
    new Set();
  private generateId: () => string;

  constructor(
    config: GhostSuggestConfig,
    generateId: () => string = () =>
      `ghost-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  ) {
    this.config = config;
    this.generateId = generateId;
  }

  /**
   * Trigger a suggestion based on the current cursor context.
   * Debounced — waits for the user to pause typing.
   */
  suggest(context: InferenceContext): void {
    const { debounceMs = 500, minChars = 3 } = this.config;

    // Don't suggest if too little content
    if (
      context.currentText.length < minChars &&
      context.precedingBlocks.length === 0
    ) {
      this.clear();
      return;
    }

    // Cancel any pending suggestion
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.abortController) this.abortController.abort();

    // Debounce
    this.debounceTimer = setTimeout(() => {
      this.fetchSuggestion(context);
    }, debounceMs);
  }

  /**
   * Accept the current suggestion — inserts it into the document.
   * Returns the suggestion text, or null if nothing to accept.
   */
  accept(): GhostSuggestion | null {
    const suggestion = this.currentSuggestion;
    this.clear();
    return suggestion;
  }

  /**
   * Dismiss the current suggestion.
   */
  dismiss(): void {
    this.clear();
  }

  /**
   * Get the current suggestion.
   */
  getCurrent(): GhostSuggestion | null {
    return this.currentSuggestion;
  }

  /**
   * Listen for suggestion changes.
   */
  onChange(listener: (suggestion: GhostSuggestion | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Clean up.
   */
  destroy(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.abortController) this.abortController.abort();
    this.listeners.clear();
  }

  // ── Private ───────────────────────────────────────────────────

  private async fetchSuggestion(context: InferenceContext): Promise<void> {
    this.abortController = new AbortController();

    try {
      // Trim context to max blocks
      const maxBlocks = this.config.maxContextBlocks ?? 5;
      const trimmedContext: InferenceContext = {
        ...context,
        precedingBlocks: context.precedingBlocks.slice(-maxBlocks),
        followingBlocks: context.followingBlocks.slice(0, 2),
        voiceModelId: this.config.voiceModelId,
      };

      const text = await this.config.infer(trimmedContext);

      if (!text || text.trim().length === 0) {
        this.clear();
        return;
      }

      // Detect block type from suggestion
      const blockType = this.detectBlockType(text);

      this.currentSuggestion = {
        id: this.generateId(),
        text: text.trim(),
        blockType,
        confidence: 0.7,
        afterBlockId: '', // set by caller
        source: 'continuation',
      };

      this.notifyListeners();
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        this.clear();
      }
    }
  }

  private detectBlockType(text: string): GhostSuggestion['blockType'] {
    if (/^#{1,6}\s/.test(text)) return 'heading';
    if (/^```/.test(text)) return 'code';
    if (/^[-*+]\s/.test(text) || /^\d+\.\s/.test(text)) return 'list';
    if (/^>\s/.test(text)) return 'blockquote';
    return 'paragraph';
  }

  private clear(): void {
    this.currentSuggestion = null;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.notifyListeners();
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.currentSuggestion);
    }
  }
}

// ── React Hook ──────────────────────────────────────────────────────

/**
 * Hook for ghost text suggestions in the editor.
 * Tab to accept, Escape to dismiss.
 */
export function useGhostSuggest(config: GhostSuggestConfig): {
  suggestion: GhostSuggestion | null;
  suggest: (context: InferenceContext) => void;
  accept: () => GhostSuggestion | null;
  dismiss: () => void;
} {
  const engineRef = useRef<GhostSuggestEngine | null>(null);
  const [suggestion, setSuggestion] = useState<GhostSuggestion | null>(null);

  useEffect(() => {
    const engine = new GhostSuggestEngine(config);
    engineRef.current = engine;
    const unsub = engine.onChange(setSuggestion);

    // Global keyboard handler for Tab / Escape
    const keyHandler = (e: KeyboardEvent) => {
      if (!engine.getCurrent()) return;

      if (e.key === 'Tab') {
        e.preventDefault();
        engine.accept();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        engine.dismiss();
      }
    };
    window.addEventListener('keydown', keyHandler);

    return () => {
      unsub();
      engine.destroy();
      window.removeEventListener('keydown', keyHandler);
    };
  }, []);

  return {
    suggestion,
    suggest: (ctx) => engineRef.current?.suggest(ctx),
    accept: () => engineRef.current?.accept() ?? null,
    dismiss: () => engineRef.current?.dismiss(),
  };
}

// ── Ghost Text Component ────────────────────────────────────────────

export interface GhostTextProps {
  suggestion: GhostSuggestion | null;
  onAccept: () => void;
  onDismiss: () => void;
}

/**
 * Renders ghost text inline after the cursor position.
 * Faded, italic, Tab to accept.
 */
export const GhostText: React.FC<GhostTextProps> = ({
  suggestion,
  onAccept,
  onDismiss,
}) => {
  if (!suggestion) return null;

  return (
    <div
      className="afc-ghost-text"
      role="status"
      aria-live="polite"
      aria-label={`Suggestion: ${suggestion.text.slice(0, 50)}...`}
    >
      <span className="afc-ghost-content">{suggestion.text}</span>
      <span className="afc-ghost-hint">
        <kbd>Tab</kbd> to accept · <kbd>Esc</kbd> to dismiss
      </span>
    </div>
  );
};
