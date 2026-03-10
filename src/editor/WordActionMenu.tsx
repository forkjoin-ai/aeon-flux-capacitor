/**
 * WordActionMenu — Click any word for AI actions
 *
 * A floating contextual menu that appears when a user clicks a word.
 * Offers AI-powered actions: Define, Translate, Rewrite, Expand,
 * Analyze, Share, Lock.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useEditor } from './EditorRoot';

// ── Types ───────────────────────────────────────────────────────────

export interface WordAction {
  /** Unique action ID */
  readonly id: string;
  /** Display label */
  readonly label: string;
  /** Icon (emoji or SVG path) */
  readonly icon: string;
  /** Action category */
  readonly category: 'ai' | 'edit' | 'share' | 'format';
  /** Whether this action requires ESI inference */
  readonly requiresESI?: boolean;
  /** Keyboard shortcut hint */
  readonly shortcut?: string;
}

export interface WordActionMenuProps {
  /** The word that was clicked */
  word: string;
  /** Bounding rect of the word */
  rect: DOMRect;
  /** Block position in the document */
  blockPosition: number;
  /** Callback to close the menu */
  onClose: () => void;
  /** Callback when an action is selected */
  onAction: (actionId: string, word: string, blockPosition: number) => void;
}

// ── Default Actions ─────────────────────────────────────────────────

const DEFAULT_ACTIONS: WordAction[] = [
  // AI actions
  {
    id: 'define',
    label: 'Define',
    icon: '📖',
    category: 'ai',
    requiresESI: true,
  },
  {
    id: 'synonyms',
    label: 'Synonyms',
    icon: '🔄',
    category: 'ai',
    requiresESI: true,
  },
  {
    id: 'translate',
    label: 'Translate',
    icon: '🌐',
    category: 'ai',
    requiresESI: true,
  },
  {
    id: 'rewrite',
    label: 'Rewrite',
    icon: '✨',
    category: 'ai',
    requiresESI: true,
  },
  {
    id: 'expand',
    label: 'Expand',
    icon: '📝',
    category: 'ai',
    requiresESI: true,
  },
  {
    id: 'tone',
    label: 'Change Tone',
    icon: '🎭',
    category: 'ai',
    requiresESI: true,
  },
  {
    id: 'analyze',
    label: 'Analyze',
    icon: '🔬',
    category: 'ai',
    requiresESI: true,
  },

  // Edit actions
  { id: 'find-similar', label: 'Find Similar', icon: '🔗', category: 'edit' },
  { id: 'highlight', label: 'Highlight', icon: '🖊️', category: 'format' },
  { id: 'comment', label: 'Comment', icon: '💬', category: 'edit' },

  // Share/Lock
  { id: 'share-block', label: 'Share Block', icon: '📤', category: 'share' },
  { id: 'lock-block', label: 'Lock Block', icon: '🔒', category: 'share' },
];

// ── Component ───────────────────────────────────────────────────────

export const WordActionMenu: React.FC<WordActionMenuProps> = ({
  word,
  rect,
  blockPosition,
  onClose,
  onAction,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [category, setCategory] = useState<string | null>(null);
  const { readOnly } = useEditor();

  // Position the menu above the word
  const top = rect.top - 8;
  const left = rect.left + rect.width / 2;

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid the click that opened the menu
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handler);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
    };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleAction = useCallback(
    (actionId: string) => {
      onAction(actionId, word, blockPosition);
      onClose();
    },
    [word, blockPosition, onAction, onClose]
  );

  // Filter actions based on category and read-only state
  const visibleActions = DEFAULT_ACTIONS.filter((action) => {
    if (
      readOnly &&
      (action.category === 'edit' || action.category === 'format')
    ) {
      return false;
    }
    if (category && action.category !== category) return false;
    return true;
  });

  // Group by category
  const categories = [...new Set(DEFAULT_ACTIONS.map((a) => a.category))];

  return (
    <div
      ref={menuRef}
      className="afc-word-action-menu"
      style={{
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`,
        transform: 'translate(-50%, -100%)',
      }}
      role="menu"
      aria-label={`Actions for "${word}"`}
    >
      {/* Word display */}
      <div className="afc-word-action-header">
        <span className="afc-word-action-word">{word}</span>
      </div>

      {/* Category tabs */}
      <div className="afc-word-action-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={category === null}
          className={`afc-word-action-tab ${
            category === null ? 'afc-active' : ''
          }`}
          onClick={() => setCategory(null)}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            role="tab"
            aria-selected={category === cat}
            className={`afc-word-action-tab ${
              category === cat ? 'afc-active' : ''
            }`}
            onClick={() => setCategory(cat)}
          >
            {cat.charAt(0).toUpperCase() + cat.slice(1)}
          </button>
        ))}
      </div>

      {/* Action grid */}
      <div className="afc-word-action-grid">
        {visibleActions.map((action) => (
          <button
            key={action.id}
            className="afc-word-action-btn"
            onClick={() => handleAction(action.id)}
            role="menuitem"
            title={
              action.shortcut
                ? `${action.label} (${action.shortcut})`
                : action.label
            }
          >
            <span className="afc-word-action-icon">{action.icon}</span>
            <span className="afc-word-action-label">{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

// ── Selection Toolbar ───────────────────────────────────────────────

export interface SelectionToolbarProps {
  /** Bounding rect of the selection */
  rect: DOMRect;
  /** Selected text */
  selectedText: string;
  /** Block position */
  blockPosition: number;
  /** Callback for formatting actions */
  onFormat: (mark: string) => void;
  /** Callback for AI actions on selection */
  onAIAction: (actionId: string, text: string) => void;
  /** Callback to close */
  onClose: () => void;
}

export const SelectionToolbar: React.FC<SelectionToolbarProps> = ({
  rect,
  selectedText,
  blockPosition,
  onFormat,
  onAIAction,
  onClose,
}) => {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const { readOnly } = useEditor();

  const top = rect.top - 8;
  const left = rect.left + rect.width / 2;

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        toolbarRef.current &&
        !toolbarRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handler);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
    };
  }, [onClose]);

  return (
    <div
      ref={toolbarRef}
      className="afc-selection-toolbar"
      style={{
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`,
        transform: 'translate(-50%, -100%)',
      }}
      role="toolbar"
      aria-label="Text formatting"
    >
      {!readOnly && (
        <div className="afc-toolbar-group">
          <button
            className="afc-fmt-btn"
            onClick={() => onFormat('bold')}
            title="Bold (Ctrl+B)"
          >
            <strong>B</strong>
          </button>
          <button
            className="afc-fmt-btn"
            onClick={() => onFormat('italic')}
            title="Italic (Ctrl+I)"
          >
            <em>I</em>
          </button>
          <button
            className="afc-fmt-btn"
            onClick={() => onFormat('code')}
            title="Code (Ctrl+`)"
          >
            {'</>'}
          </button>
          <button
            className="afc-fmt-btn"
            onClick={() => onFormat('link')}
            title="Link (Ctrl+K)"
          >
            🔗
          </button>
          <button
            className="afc-fmt-btn"
            onClick={() => onFormat('highlight')}
            title="Highlight"
          >
            🖊️
          </button>
          <button
            className="afc-fmt-btn"
            onClick={() => onFormat('strikethrough')}
            title="Strikethrough"
          >
            <s>S</s>
          </button>
        </div>
      )}

      <div className="afc-toolbar-divider" />

      <div className="afc-toolbar-group">
        <button
          className="afc-fmt-btn"
          onClick={() => onAIAction('rewrite', selectedText)}
          title="AI Rewrite"
        >
          ✨
        </button>
        <button
          className="afc-fmt-btn"
          onClick={() => onAIAction('translate', selectedText)}
          title="Translate"
        >
          🌐
        </button>
        <button
          className="afc-fmt-btn"
          onClick={() => onAIAction('expand', selectedText)}
          title="Expand"
        >
          📝
        </button>
      </div>
    </div>
  );
};
