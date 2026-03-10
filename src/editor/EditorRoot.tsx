/**
 * EditorRoot — The top-level editor component
 *
 * Mobile-first, fullscreenable, with 4 view modes:
 * Edit (WYSIWYG), Markdown (raw), Preview (read-only), Spatial (3D).
 * Toggle with Ctrl+Shift+V.
 */

import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import type { AeonDocument } from '../document/document';
import type { EmbeddingDocument } from '../core/EmbeddingDocument';
import type { RevisionManager } from '../revisions/RevisionManager';
import type { EntityLayer } from '../core/EntityLayer';
import type { SemanticGraph } from '../core/SemanticGraph';

// ── Types ───────────────────────────────────────────────────────────

/** The four view modes */
export type ViewMode = 'edit' | 'markdown' | 'preview' | 'spatial';

/** Editor configuration */
export interface EditorConfig {
  /** Initial view mode */
  initialMode?: ViewMode;
  /** Whether the editor starts in fullscreen */
  fullscreen?: boolean;
  /** Whether to show the entity panel */
  showEntityPanel?: boolean;
  /** Whether to show the Tukey stats panel */
  showStatsPanel?: boolean;
  /** Whether to show the revision timeline */
  showTimeline?: boolean;
  /** Whether to show the task panel (fractal-todo) */
  showTaskPanel?: boolean;
  /** Placeholder text for empty documents */
  placeholder?: string;
  /** Whether the editor is read-only */
  readOnly?: boolean;
}

/** Editor context passed to all child components */
export interface EditorContext {
  /** The CRDT document */
  doc: AeonDocument;
  /** The embedding document */
  embeddingDoc: EmbeddingDocument;
  /** The revision manager */
  revisions: RevisionManager;
  /** The entity layer */
  entities: EntityLayer;
  /** The semantic graph */
  semanticGraph: SemanticGraph;
  /** Current view mode */
  viewMode: ViewMode;
  /** Whether in fullscreen */
  isFullscreen: boolean;
  /** Whether read-only */
  readOnly: boolean;
  /** Switch view mode */
  setViewMode: (mode: ViewMode) => void;
  /** Toggle fullscreen */
  toggleFullscreen: () => void;
}

/** Props for EditorRoot */
export interface EditorRootProps {
  /** The CRDT document */
  doc: AeonDocument;
  /** The embedding document */
  embeddingDoc: EmbeddingDocument;
  /** The revision manager */
  revisions: RevisionManager;
  /** The entity layer */
  entities: EntityLayer;
  /** The semantic graph */
  semanticGraph: SemanticGraph;
  /** Editor configuration */
  config?: EditorConfig;
  /** Children to render in the editor chrome */
  children?: ReactNode;
  /** CSS class name override */
  className?: string;
}

// ── React Context ───────────────────────────────────────────────────

export const EditorCtx = React.createContext<EditorContext | null>(null);

/** Hook to access the editor context */
export function useEditor(): EditorContext {
  const ctx = React.useContext(EditorCtx);
  if (!ctx) throw new Error('useEditor must be used within <EditorRoot>');
  return ctx;
}

// ── View Mode Cycle ─────────────────────────────────────────────────

const VIEW_MODE_ORDER: ViewMode[] = ['edit', 'markdown', 'preview', 'spatial'];

function nextViewMode(current: ViewMode): ViewMode {
  const idx = VIEW_MODE_ORDER.indexOf(current);
  return VIEW_MODE_ORDER[(idx + 1) % VIEW_MODE_ORDER.length];
}

// ── Component ───────────────────────────────────────────────────────

export const EditorRoot: React.FC<EditorRootProps> = ({
  doc,
  embeddingDoc,
  revisions,
  entities,
  semanticGraph,
  config = {},
  children,
  className,
}) => {
  const {
    initialMode = 'edit',
    fullscreen: initialFullscreen = false,
    readOnly = false,
    placeholder = 'Start writing...',
  } = config;

  const [viewMode, setViewMode] = useState<ViewMode>(initialMode);
  const [isFullscreen, setIsFullscreen] = useState(initialFullscreen);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fullscreen API
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current
        .requestFullscreen()
        .then(() => {
          setIsFullscreen(true);
        })
        .catch(() => {
          // Fullscreen not supported — just toggle the state
          setIsFullscreen((prev) => !prev);
        });
    } else {
      document
        .exitFullscreen()
        .then(() => {
          setIsFullscreen(false);
        })
        .catch(() => {
          setIsFullscreen(false);
        });
    }
  }, []);

  // Listen for fullscreen changes
  useEffect(() => {
    const handler = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // Keyboard shortcut: Ctrl+Shift+V to cycle view modes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'V') {
        e.preventDefault();
        setViewMode((current) => nextViewMode(current));
      }
      // Ctrl+Shift+F for fullscreen
      if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      }
      // Ctrl+Z for undo (in edit mode)
      if (e.ctrlKey && !e.shiftKey && e.key === 'z' && viewMode === 'edit') {
        e.preventDefault();
        doc.undo();
      }
      // Ctrl+Shift+Z for redo
      if (e.ctrlKey && e.shiftKey && e.key === 'Z' && viewMode === 'edit') {
        e.preventDefault();
        doc.redo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [viewMode, doc, toggleFullscreen]);

  // Build context
  const context: EditorContext = {
    doc,
    embeddingDoc,
    revisions,
    entities,
    semanticGraph,
    viewMode,
    isFullscreen,
    readOnly,
    setViewMode,
    toggleFullscreen,
  };

  return (
    <EditorCtx.Provider value={context}>
      <div
        ref={containerRef}
        className={`afc-editor-root ${
          isFullscreen ? 'afc-fullscreen' : ''
        } afc-mode-${viewMode} ${className || ''}`}
        data-view-mode={viewMode}
        data-fullscreen={isFullscreen}
        data-readonly={readOnly}
      >
        {/* Toolbar */}
        <header className="afc-toolbar">
          <div className="afc-toolbar-left">
            <ViewModeSelector current={viewMode} onChange={setViewMode} />
          </div>
          <div className="afc-toolbar-right">
            <button
              className="afc-btn afc-btn-icon"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? '⊘' : '⊡'}
            </button>
          </div>
        </header>

        {/* Main editing surface */}
        <main className="afc-editor-surface">
          {doc.blockCount === 0 && viewMode === 'edit' && (
            <div className="afc-placeholder">{placeholder}</div>
          )}
          {children}
        </main>
      </div>
    </EditorCtx.Provider>
  );
};

// ── View Mode Selector ──────────────────────────────────────────────

const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  edit: 'Edit',
  markdown: 'Markdown',
  preview: 'Preview',
  spatial: 'Spatial',
};

const VIEW_MODE_ICONS: Record<ViewMode, string> = {
  edit: '✎',
  markdown: '⌘',
  preview: '◎',
  spatial: '⬡',
};

interface ViewModeSelectorProps {
  current: ViewMode;
  onChange: (mode: ViewMode) => void;
}

const ViewModeSelector: React.FC<ViewModeSelectorProps> = ({
  current,
  onChange,
}) => (
  <div className="afc-view-mode-selector" role="tablist">
    {VIEW_MODE_ORDER.map((mode) => (
      <button
        key={mode}
        role="tab"
        aria-selected={mode === current}
        className={`afc-view-mode-tab ${mode === current ? 'afc-active' : ''}`}
        onClick={() => onChange(mode)}
        title={`${VIEW_MODE_LABELS[mode]} (Ctrl+Shift+V to cycle)`}
      >
        <span className="afc-view-mode-icon">{VIEW_MODE_ICONS[mode]}</span>
        <span className="afc-view-mode-label">{VIEW_MODE_LABELS[mode]}</span>
      </button>
    ))}
  </div>
);
