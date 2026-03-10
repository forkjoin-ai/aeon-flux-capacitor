/**
 * CommandPalette — Spotlight-style omnisearch
 *
 * Cmd+K / Ctrl+K summons the palette. Everything is latent,
 * ready to summon, and instant when called.
 *
 * Search across: blocks, entities, revisions, tools, actions,
 * semantic similarity, commands. Single surface, infinite depth.
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import { useEditor } from './EditorRoot';

// ── Types ───────────────────────────────────────────────────────────

/** A command palette item */
export interface PaletteItem {
  /** Unique ID */
  readonly id: string;
  /** Display label */
  readonly label: string;
  /** Optional subtitle/preview */
  readonly subtitle?: string;
  /** Category for grouping */
  readonly category: PaletteCategory;
  /** Icon (emoji or string) */
  readonly icon: string;
  /** Keyboard shortcut hint */
  readonly shortcut?: string;
  /** Search keywords (invisible, boost matching) */
  readonly keywords?: string[];
  /** Action to execute */
  readonly action: () => void | Promise<void>;
}

export type PaletteCategory =
  | 'navigation' // Jump to a block, heading, section
  | 'entity' // Jump to / filter by entity
  | 'revision' // Time-travel, rollback, branch
  | 'tool' // AI tools: rewrite, translate, expand
  | 'format' // Bold, italic, heading, code
  | 'view' // Switch view mode
  | 'document' // New doc, export, share
  | 'search'; // Semantic search results

export interface CommandPaletteProps {
  /** Extra items to register */
  extraItems?: PaletteItem[];
  /** Callback when the palette closes */
  onClose?: () => void;
}

const CATEGORY_ORDER: PaletteCategory[] = [
  'navigation',
  'search',
  'entity',
  'tool',
  'format',
  'revision',
  'view',
  'document',
];

const CATEGORY_LABELS: Record<PaletteCategory, string> = {
  navigation: 'Navigation',
  search: 'Search',
  entity: 'Entities',
  tool: 'AI Tools',
  format: 'Format',
  revision: 'Revisions',
  view: 'View',
  document: 'Document',
};

// ── Component ───────────────────────────────────────────────────────

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  extraItems = [],
  onClose,
}) => {
  const {
    doc,
    embeddingDoc,
    entities,
    revisions,
    setViewMode,
    toggleFullscreen,
  } = useEditor();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Build the full item list
  const allItems = useMemo(() => {
    const items: PaletteItem[] = [];

    // Navigation — headings and blocks
    const blocks = doc.getAllBlocks();
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const blockType = block.nodeName;
      if (blockType === 'heading') {
        const text = block.toString();
        const level = block.getAttribute('level') || '1';
        items.push({
          id: `nav-${i}`,
          label: text,
          subtitle: `H${level}`,
          category: 'navigation',
          icon: '§',
          action: () => {
            // Scroll to this block
            const el = document.querySelector(`[data-position="${i}"]`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          },
        });
      }
    }

    // Entities
    for (const entity of entities.getAllEntities()) {
      items.push({
        id: `entity-${entity.id}`,
        label: entity.text,
        subtitle: `${entity.type} · ${entity.occurrences.length} occurrences`,
        category: 'entity',
        icon: entityIcon(entity.type),
        keywords: [entity.type],
        action: () => {
          // TODO: highlight entity occurrences
        },
      });
    }

    // Revisions
    for (const rev of revisions.listRevisions().slice(0, 10)) {
      items.push({
        id: `rev-${rev.id}`,
        label: rev.label,
        subtitle: new Date(rev.createdAt).toLocaleString(),
        category: 'revision',
        icon: '⟲',
        action: () => {
          revisions.rollbackTo(rev.id, doc);
        },
      });
    }

    // AI Tools
    const aiActions: Array<{
      id: string;
      label: string;
      icon: string;
      shortcut?: string;
    }> = [
      { id: 'rewrite', label: 'Rewrite Selection', icon: '✨' },
      { id: 'expand', label: 'Expand Selection', icon: '📝' },
      { id: 'translate', label: 'Translate', icon: '🌐' },
      { id: 'summarize', label: 'Summarize Document', icon: '📋' },
      { id: 'voice-analyze', label: 'Analyze Voice / Tone', icon: '🎭' },
      { id: 'voice-generate', label: 'Generate In-Voice', icon: '✍️' },
      { id: 'find-similar', label: 'Find Semantically Similar', icon: '🔗' },
    ];
    for (const action of aiActions) {
      items.push({
        id: `tool-${action.id}`,
        label: action.label,
        category: 'tool',
        icon: action.icon,
        shortcut: action.shortcut,
        action: () => {
          // dispatch to ESI
        },
      });
    }

    // Format
    const formatActions = [
      { id: 'bold', label: 'Bold', icon: 'B', shortcut: 'Ctrl+B' },
      { id: 'italic', label: 'Italic', icon: 'I', shortcut: 'Ctrl+I' },
      { id: 'code', label: 'Code', icon: '</>', shortcut: 'Ctrl+`' },
      { id: 'heading-1', label: 'Heading 1', icon: 'H1', shortcut: 'Ctrl+1' },
      { id: 'heading-2', label: 'Heading 2', icon: 'H2', shortcut: 'Ctrl+2' },
      { id: 'heading-3', label: 'Heading 3', icon: 'H3', shortcut: 'Ctrl+3' },
      { id: 'blockquote', label: 'Quote', icon: '❝' },
      { id: 'list', label: 'Bullet List', icon: '•' },
      { id: 'task', label: 'Task List', icon: '☐' },
    ];
    for (const action of formatActions) {
      items.push({
        id: `fmt-${action.id}`,
        label: action.label,
        category: 'format',
        icon: action.icon,
        shortcut: action.shortcut,
        action: () => {},
      });
    }

    // View
    items.push(
      {
        id: 'view-edit',
        label: 'Edit Mode',
        category: 'view',
        icon: '✎',
        shortcut: 'Ctrl+Shift+V',
        action: () => setViewMode('edit'),
      },
      {
        id: 'view-markdown',
        label: 'Markdown Mode',
        category: 'view',
        icon: '⌘',
        action: () => setViewMode('markdown'),
      },
      {
        id: 'view-preview',
        label: 'Preview Mode',
        category: 'view',
        icon: '◎',
        action: () => setViewMode('preview'),
      },
      {
        id: 'view-spatial',
        label: 'Spatial Mode',
        category: 'view',
        icon: '⬡',
        action: () => setViewMode('spatial'),
      },
      {
        id: 'fullscreen',
        label: 'Toggle Fullscreen',
        category: 'view',
        icon: '⊡',
        shortcut: 'Ctrl+Shift+F',
        action: toggleFullscreen,
      }
    );

    // Document
    items.push(
      {
        id: 'doc-export-md',
        label: 'Export as Markdown',
        category: 'document',
        icon: '📄',
        action: () => {},
      },
      {
        id: 'doc-export-json',
        label: 'Export as JSON',
        category: 'document',
        icon: '{ }',
        action: () => {},
      },
      {
        id: 'doc-stats',
        label: 'Document Statistics',
        category: 'document',
        icon: '📊',
        action: () => {},
      }
    );

    // Extra items from props
    items.push(...extraItems);

    return items;
  }, [
    doc,
    embeddingDoc,
    entities,
    revisions,
    extraItems,
    setViewMode,
    toggleFullscreen,
  ]);

  // Filter items by query
  const filtered = useMemo(() => {
    if (!query.trim()) return allItems;
    const q = query.toLowerCase();
    return allItems.filter((item) => {
      if (item.label.toLowerCase().includes(q)) return true;
      if (item.subtitle?.toLowerCase().includes(q)) return true;
      if (item.keywords?.some((kw) => kw.toLowerCase().includes(q)))
        return true;
      return false;
    });
  }, [allItems, query]);

  // Group by category
  const grouped = useMemo(() => {
    const groups = new Map<PaletteCategory, PaletteItem[]>();
    for (const item of filtered) {
      const list = groups.get(item.category) || [];
      list.push(item);
      groups.set(item.category, list);
    }
    return CATEGORY_ORDER.filter((cat) => groups.has(cat)).map((cat) => ({
      category: cat,
      items: groups.get(cat)!,
    }));
  }, [filtered]);

  // Flat list for keyboard navigation
  const flatItems = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  // Clamp selected index
  useEffect(() => {
    setSelectedIndex((prev) =>
      Math.min(prev, Math.max(0, flatItems.length - 1))
    );
  }, [flatItems.length]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, flatItems.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (flatItems[selectedIndex]) {
            flatItems[selectedIndex].action();
            onClose?.();
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose?.();
          break;
      }
    },
    [flatItems, selectedIndex, onClose]
  );

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(
      `[data-index="${selectedIndex}"]`
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  return (
    <div className="afc-palette-overlay" onClick={onClose}>
      <div
        className="afc-palette"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Command Palette"
      >
        {/* Search input */}
        <div className="afc-palette-input-wrap">
          <span className="afc-palette-search-icon">⌘</span>
          <input
            ref={inputRef}
            className="afc-palette-input"
            type="text"
            placeholder="Search commands, blocks, entities, tools..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="afc-palette-kbd">ESC</kbd>
        </div>

        {/* Results */}
        <div className="afc-palette-results" ref={listRef}>
          {grouped.length === 0 && (
            <div className="afc-palette-empty">No results for "{query}"</div>
          )}
          {grouped.map(({ category, items }) => (
            <div key={category} className="afc-palette-group">
              <div className="afc-palette-group-label">
                {CATEGORY_LABELS[category]}
              </div>
              {items.map((item) => {
                const globalIdx = flatItems.indexOf(item);
                return (
                  <button
                    key={item.id}
                    className={`afc-palette-item ${
                      globalIdx === selectedIndex ? 'afc-selected' : ''
                    }`}
                    data-index={globalIdx}
                    onClick={() => {
                      item.action();
                      onClose?.();
                    }}
                    onMouseEnter={() => setSelectedIndex(globalIdx)}
                    role="option"
                    aria-selected={globalIdx === selectedIndex}
                  >
                    <span className="afc-palette-item-icon">{item.icon}</span>
                    <div className="afc-palette-item-text">
                      <span className="afc-palette-item-label">
                        {item.label}
                      </span>
                      {item.subtitle && (
                        <span className="afc-palette-item-subtitle">
                          {item.subtitle}
                        </span>
                      )}
                    </div>
                    {item.shortcut && (
                      <kbd className="afc-palette-item-shortcut">
                        {item.shortcut}
                      </kbd>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ── Hook: useCommandPalette ─────────────────────────────────────────

/**
 * Hook to manage the command palette visibility.
 * Listens for Ctrl+K / Cmd+K globally.
 */
export function useCommandPalette(): {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
} {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    toggle: () => setIsOpen((prev) => !prev),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

function entityIcon(type: string): string {
  const map: Record<string, string> = {
    person: '👤',
    organization: '🏢',
    location: '📍',
    date: '📅',
    event: '🎪',
    concept: '💡',
  };
  return map[type] || '•';
}
