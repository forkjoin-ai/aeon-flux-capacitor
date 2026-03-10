/**
 * BlockRenderer — Per-block contenteditable rendering
 *
 * Each block is a contenteditable div bound to its Yjs XmlElement.
 * Renders the embedding state (entities, classification) as overlays.
 * The text is the human-readable projection of the embedding.
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import type * as Y from 'yjs';
import { useEditor } from './EditorRoot';

// ── Types ───────────────────────────────────────────────────────────

export interface BlockRendererProps {
  /** The Yjs XmlElement for this block */
  element: Y.XmlElement;
  /** The embedding ID linked to this block */
  embeddingId: string;
  /** Position in the document */
  position: number;
  /** Whether this block is currently focused */
  focused?: boolean;
  /** Callback when this block receives focus */
  onFocus?: (position: number) => void;
  /** Callback when text changes */
  onTextChange?: (position: number, text: string) => void;
  /** Callback when a word is clicked */
  onWordClick?: (word: string, rect: DOMRect, position: number) => void;
}

// ── Component ───────────────────────────────────────────────────────

export const BlockRenderer: React.FC<BlockRendererProps> = ({
  element,
  embeddingId,
  position,
  focused = false,
  onFocus,
  onTextChange,
  onWordClick,
}) => {
  const { embeddingDoc, entities, readOnly, viewMode } = useEditor();
  const contentRef = useRef<HTMLDivElement>(null);
  const [entityHighlights, setEntityHighlights] = useState<
    Array<{ start: number; end: number; type: string; label: string }>
  >([]);

  const blockType = element.nodeName;
  const blockId = element.getAttribute('id') || '';
  const text = element.toString();

  // Get the embedding node for this block
  const embeddedNode = embeddingDoc.getNode(embeddingId);

  // Update entity highlights when entities change
  useEffect(() => {
    if (!embeddedNode) return;
    const highlights = embeddedNode.entities.map((e) => ({
      start: e.start,
      end: e.end,
      type: e.type,
      label: e.text,
    }));
    setEntityHighlights(highlights);
  }, [embeddedNode?.entities]);

  // Handle contenteditable input
  const handleInput = useCallback(() => {
    if (!contentRef.current) return;
    const newText = contentRef.current.textContent || '';
    onTextChange?.(position, newText);
  }, [position, onTextChange]);

  // Handle focus
  const handleFocus = useCallback(() => {
    onFocus?.(position);
  }, [position, onFocus]);

  // Handle word click (for word-level action menu)
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!contentRef.current) return;

      const selection = window.getSelection();
      if (!selection || !selection.focusNode) return;

      // Get the word at the click position
      const range = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (!range) return;

      // Expand range to word boundaries
      const node = range.startContainer;
      if (node.nodeType !== Node.TEXT_NODE) return;

      const textContent = node.textContent || '';
      let start = range.startOffset;
      let end = range.startOffset;

      // Find word boundaries
      while (start > 0 && /\w/.test(textContent[start - 1])) start--;
      while (end < textContent.length && /\w/.test(textContent[end])) end++;

      if (start === end) return;

      const word = textContent.substring(start, end);

      // Get the bounding rect for the word
      const wordRange = document.createRange();
      wordRange.setStart(node, start);
      wordRange.setEnd(node, end);
      const rect = wordRange.getBoundingClientRect();

      onWordClick?.(word, rect, position);
    },
    [position, onWordClick]
  );

  // Determine the HTML element type
  const Tag = getBlockTag(blockType);
  const headingLevel = element.getAttribute('level');
  const isEditable = viewMode === 'edit' && !readOnly;

  return (
    <div
      className={`afc-block afc-block-${blockType} ${
        focused ? 'afc-focused' : ''
      }`}
      data-block-id={blockId}
      data-embedding-id={embeddingId}
      data-block-type={blockType}
      data-position={position}
    >
      {/* Entity highlight indicators */}
      {entityHighlights.length > 0 && (
        <div className="afc-block-entities" aria-hidden="true">
          {entityHighlights.map((h, idx) => (
            <span
              key={idx}
              className={`afc-entity-dot afc-entity-${h.type}`}
              title={`${h.type}: ${h.label}`}
            />
          ))}
        </div>
      )}

      {/* Classification badge */}
      {embeddedNode?.classification.topic && (
        <div className="afc-block-classification" aria-hidden="true">
          <span className="afc-classification-badge">
            {embeddedNode.classification.topic}
          </span>
        </div>
      )}

      {/* Lock indicator */}
      {embeddedNode?.metadata.lockState && (
        <div
          className="afc-block-locked"
          title={`Locked by ${embeddedNode.metadata.lockState.lockedBy}`}
        >
          🔒
        </div>
      )}

      {/* The actual content */}
      {Tag === 'h1' ||
      Tag === 'h2' ||
      Tag === 'h3' ||
      Tag === 'h4' ||
      Tag === 'h5' ||
      Tag === 'h6' ? (
        React.createElement(
          Tag,
          {
            ref: contentRef,
            contentEditable: isEditable,
            suppressContentEditableWarning: true,
            onInput: handleInput,
            onFocus: handleFocus,
            onClick: handleClick,
            className: 'afc-block-content',
            'data-placeholder': 'Heading...',
          },
          text
        )
      ) : blockType === 'code' ? (
        <pre className="afc-code-block">
          <code
            ref={contentRef as React.Ref<HTMLElement>}
            contentEditable={isEditable}
            suppressContentEditableWarning
            onInput={handleInput}
            onFocus={handleFocus}
            className={`afc-block-content language-${
              element.getAttribute('language') || 'text'
            }`}
          >
            {text}
          </code>
        </pre>
      ) : blockType === 'divider' ? (
        <hr className="afc-divider" />
      ) : (
        React.createElement(
          Tag,
          {
            ref: contentRef,
            contentEditable: isEditable,
            suppressContentEditableWarning: true,
            onInput: handleInput,
            onFocus: handleFocus,
            onClick: handleClick,
            className: 'afc-block-content',
            'data-placeholder':
              blockType === 'paragraph' ? 'Type something...' : '',
          },
          text
        )
      )}

      {/* Sentiment indicator */}
      {embeddedNode && embeddedNode.classification.confidence > 0.5 && (
        <div
          className="afc-sentiment-bar"
          style={
            {
              '--sentiment': embeddedNode.classification.sentiment,
            } as React.CSSProperties
          }
          title={`Sentiment: ${embeddedNode.classification.sentiment.toFixed(
            2
          )}`}
          aria-hidden="true"
        />
      )}
    </div>
  );
};

// ── Helpers ─────────────────────────────────────────────────────────

type BlockTag =
  | 'p'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'blockquote'
  | 'li'
  | 'pre'
  | 'div'
  | 'hr';

function getBlockTag(blockType: string): BlockTag {
  switch (blockType) {
    case 'paragraph':
      return 'p';
    case 'heading':
      return 'h2'; // Default; actual level set via attribute
    case 'blockquote':
      return 'blockquote';
    case 'list-item':
    case 'task-item':
      return 'li';
    case 'code':
      return 'pre';
    case 'divider':
      return 'hr';
    default:
      return 'div';
  }
}
