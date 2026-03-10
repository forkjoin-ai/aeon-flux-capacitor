/**
 * ReadingProjection — The document as a beautiful reading experience
 *
 * Medium's secret was never the editor. It was the READING experience.
 * Ghost made publishing fast. Neither made reading unforgettable.
 *
 * Reading is another projection of the embedding space:
 *   - Progressive disclosure for long documents
 *   - Estimated reading time (238 wpm, Medium's number)
 *   - Footnotes and sidenotes (Tufte-style)
 *   - Focus mode that strips everything
 *   - Scroll-linked typography (dynamic sizing, contrast)
 *   - Ambient audio from the audio projection
 *
 * The reading mode IS a projection surface, just like text or 3D.
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';

// ── Types ───────────────────────────────────────────────────────────

export interface ReadingConfig {
  /** Words per minute for reading time computation (default: 238) */
  readonly wpm?: number;
  /** Whether to enable progressive disclosure (default: true) */
  readonly progressiveDisclosure?: boolean;
  /** Number of blocks to show initially (default: 10) */
  readonly initialBlocks?: number;
  /** Whether to show footnotes as sidenotes on wide screens (default: true) */
  readonly sidenotes?: boolean;
  /** Whether to enable focus mode (default: false) */
  readonly focusMode?: boolean;
  /** Whether to dim non-focused paragraphs (default: true in focus mode) */
  readonly dimUnfocused?: boolean;
  /** Custom font family for reading (default: serif) */
  readonly fontFamily?: string;
  /** Base font size in px (default: 20) */
  readonly fontSize?: number;
  /** Line height (default: 1.8) */
  readonly lineHeight?: number;
  /** Maximum content width in px (default: 680) */
  readonly maxWidth?: number;
}

export interface ReadingMetrics {
  /** Word count */
  readonly wordCount: number;
  /** Estimated reading time */
  readonly readingTime: { minutes: number; label: string };
  /** Number of footnotes */
  readonly footnoteCount: number;
  /** Number of sections */
  readonly sectionCount: number;
  /** Document depth (heading nesting) */
  readonly maxHeadingDepth: number;
}

export interface Footnote {
  /** Footnote ID */
  readonly id: string;
  /** Reference number */
  readonly number: number;
  /** Footnote content */
  readonly content: string;
  /** Block ID where the footnote reference appears */
  readonly referenceBlockId: string;
}

export interface TableOfContentsEntry {
  /** Block ID */
  readonly blockId: string;
  /** Heading text */
  readonly text: string;
  /** Heading depth (1-6) */
  readonly depth: number;
  /** Nested children */
  readonly children: TableOfContentsEntry[];
}

// ── Reading Projection Engine ───────────────────────────────────────

export class ReadingProjection {
  private config: Required<ReadingConfig>;
  private footnotes: Footnote[] = [];
  private toc: TableOfContentsEntry[] = [];
  private scrollProgress = 0;
  private activeBlockId: string | null = null;
  private listeners: Set<(event: ReadingEvent) => void> = new Set();

  constructor(config: ReadingConfig = {}) {
    this.config = {
      wpm: config.wpm ?? 238,
      progressiveDisclosure: config.progressiveDisclosure ?? true,
      initialBlocks: config.initialBlocks ?? 10,
      sidenotes: config.sidenotes ?? true,
      focusMode: config.focusMode ?? false,
      dimUnfocused: config.dimUnfocused ?? true,
      fontFamily:
        config.fontFamily ??
        '"Source Serif 4", "Source Serif Pro", Georgia, serif',
      fontSize: config.fontSize ?? 20,
      lineHeight: config.lineHeight ?? 1.8,
      maxWidth: config.maxWidth ?? 680,
    };
  }

  /**
   * Analyze a document for reading metrics.
   */
  analyze(blocks: Array<{ text: string; blockType: string }>): ReadingMetrics {
    const allText = blocks.map((b) => b.text).join(' ');
    const wordCount = allText.split(/\s+/).filter(Boolean).length;
    const minutes = Math.max(1, Math.ceil(wordCount / this.config.wpm));

    const headings = blocks.filter((b) => b.blockType.startsWith('heading'));
    const footnoteMatches = allText.match(/\[\^[^\]]+\]/g);

    return {
      wordCount,
      readingTime: {
        minutes,
        label: minutes === 1 ? '1 min read' : `${minutes} min read`,
      },
      footnoteCount: footnoteMatches?.length ?? 0,
      sectionCount: headings.length,
      maxHeadingDepth: headings.reduce((max, h) => {
        const depth = parseInt(h.blockType.replace('heading', ''), 10) || 1;
        return Math.max(max, depth);
      }, 0),
    };
  }

  /**
   * Build the table of contents from headings.
   */
  buildTableOfContents(
    blocks: Array<{ id: string; text: string; blockType: string }>
  ): TableOfContentsEntry[] {
    const entries: TableOfContentsEntry[] = [];
    const stack: TableOfContentsEntry[] = [];

    for (const block of blocks) {
      if (!block.blockType.startsWith('heading')) continue;

      const depth = parseInt(block.blockType.replace('heading', ''), 10) || 1;
      const entry: TableOfContentsEntry = {
        blockId: block.id,
        text: block.text,
        depth,
        children: [],
      };

      // Find parent
      while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
        stack.pop();
      }

      if (stack.length === 0) {
        entries.push(entry);
      } else {
        stack[stack.length - 1].children.push(entry);
      }

      stack.push(entry);
    }

    this.toc = entries;
    return entries;
  }

  /**
   * Extract footnotes from document blocks.
   * Supports [^label] syntax.
   */
  extractFootnotes(blocks: Array<{ id: string; text: string }>): Footnote[] {
    const footnotes: Footnote[] = [];
    const definitions: Map<string, string> = new Map();
    const references: Map<string, string> = new Map();

    // First pass: find footnote definitions [^label]: content
    for (const block of blocks) {
      const defMatches = block.text.matchAll(/\[\^([^\]]+)\]:\s*(.+)/g);
      for (const match of defMatches) {
        definitions.set(match[1], match[2]);
      }
    }

    // Second pass: find references [^label]
    let counter = 0;
    for (const block of blocks) {
      const refMatches = block.text.matchAll(/\[\^([^\]]+)\](?!:)/g);
      for (const match of refMatches) {
        const label = match[1];
        if (references.has(label)) continue;

        counter++;
        references.set(label, block.id);

        footnotes.push({
          id: label,
          number: counter,
          content: definitions.get(label) ?? `[Footnote ${label}]`,
          referenceBlockId: block.id,
        });
      }
    }

    this.footnotes = footnotes;
    return footnotes;
  }

  /**
   * Get reading CSS custom properties for the reading projection.
   */
  getReadingStyles(): Record<string, string> {
    return {
      '--reading-font': this.config.fontFamily,
      '--reading-font-size': `${this.config.fontSize}px`,
      '--reading-line-height': `${this.config.lineHeight}`,
      '--reading-max-width': `${this.config.maxWidth}px`,
      '--reading-paragraph-spacing': `${this.config.fontSize * 0.8}px`,
    };
  }

  /**
   * Update scroll progress and determine which block is in focus.
   */
  updateScroll(progress: number, activeBlockId: string): void {
    this.scrollProgress = progress;
    this.activeBlockId = activeBlockId;
    this.emit({ type: 'scroll', progress, activeBlockId });
  }

  /**
   * Toggle focus mode.
   */
  setFocusMode(enabled: boolean): void {
    this.config = { ...this.config, focusMode: enabled };
    this.emit({ type: 'focus-mode', enabled });
  }

  /**
   * Get the table of contents.
   */
  getTableOfContents(): TableOfContentsEntry[] {
    return this.toc;
  }

  /**
   * Get footnotes.
   */
  getFootnotes(): Footnote[] {
    return this.footnotes;
  }

  /**
   * Listen for reading events.
   */
  onEvent(listener: (event: ReadingEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── Private ───────────────────────────────────────────────────

  private emit(event: ReadingEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

// ── Reading Events ──────────────────────────────────────────────────

export type ReadingEvent =
  | { type: 'scroll'; progress: number; activeBlockId: string }
  | { type: 'focus-mode'; enabled: boolean }
  | { type: 'footnote-hover'; footnoteId: string }
  | { type: 'toc-navigate'; blockId: string };
