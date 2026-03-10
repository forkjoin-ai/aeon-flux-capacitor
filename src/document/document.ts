/**
 * AeonDocument — The CRDT Surface
 *
 * Wraps a Yjs Y.Doc with an XmlFragment that represents
 * the document as a CRDT tree. This is the "text projection"
 * of the underlying embedding space — the human-readable view.
 *
 * Each block in the XmlFragment corresponds to an EmbeddedNode.
 * The CRDT ensures conflict-free collaborative editing.
 */

import * as Y from 'yjs';

// ── Types ───────────────────────────────────────────────────────────

/** Block schema definitions for the CRDT tree */
export interface BlockSchema {
  /** Block type identifier */
  readonly type: string;
  /** Allowed child types (empty = leaf node) */
  readonly children: string[];
  /** Required attributes */
  readonly attributes: string[];
  /** Optional attributes */
  readonly optionalAttributes?: string[];
  /** Whether this block type is inline */
  readonly inline?: boolean;
}

/** Inline mark types */
export type InlineMark =
  | 'bold'
  | 'italic'
  | 'code'
  | 'link'
  | 'highlight'
  | 'strikethrough'
  | 'underline'
  | 'subscript'
  | 'superscript'
  | 'entity-ref';

/** Document change event */
export type DocumentEvent =
  | { type: 'block-inserted'; blockId: string; position: number }
  | { type: 'block-removed'; blockId: string }
  | { type: 'block-updated'; blockId: string }
  | { type: 'text-changed'; blockId: string; text: string }
  | { type: 'attribute-changed'; blockId: string; key: string; value: unknown }
  | { type: 'undo' }
  | { type: 'redo' };

export type DocumentListener = (event: DocumentEvent) => void;

// ── Schema ──────────────────────────────────────────────────────────

/**
 * The document schema — defines allowed block types and their structure.
 * Enforces a consistent tree shape across all collaborators.
 */
export const DOCUMENT_SCHEMA: Record<string, BlockSchema> = {
  paragraph: {
    type: 'paragraph',
    children: [],
    attributes: ['id', 'embedding-id'],
  },
  heading: {
    type: 'heading',
    children: [],
    attributes: ['id', 'embedding-id', 'level'],
  },
  'list-item': {
    type: 'list-item',
    children: [],
    attributes: ['id', 'embedding-id', 'indent', 'list-type'],
  },
  blockquote: {
    type: 'blockquote',
    children: ['paragraph'],
    attributes: ['id', 'embedding-id'],
  },
  code: {
    type: 'code',
    children: [],
    attributes: ['id', 'embedding-id', 'language', 'line-numbers'],
  },
  embed: {
    type: 'embed',
    children: [],
    attributes: [
      'id',
      'embedding-id',
      'url',
      'provider',
      'html',
      'width',
      'height',
    ],
  },
  image: {
    type: 'image',
    children: [],
    attributes: ['id', 'embedding-id', 'src', 'alt', 'width', 'height'],
  },
  divider: {
    type: 'divider',
    children: [],
    attributes: ['id'],
  },
  table: {
    type: 'table',
    children: ['table-row'],
    attributes: ['id', 'embedding-id', 'columns'],
  },
  'table-row': {
    type: 'table-row',
    children: ['table-cell'],
    attributes: ['id'],
  },
  'table-cell': {
    type: 'table-cell',
    children: [],
    attributes: ['id'],
  },
  callout: {
    type: 'callout',
    children: ['paragraph'],
    attributes: ['id', 'embedding-id', 'callout-type', 'icon'],
  },
  esi: {
    type: 'esi',
    children: [],
    attributes: ['id', 'embedding-id', 'tag-name', 'props'],
  },
  'task-item': {
    type: 'task-item',
    children: [],
    attributes: ['id', 'embedding-id', 'checked', 'fractal-todo-id'],
  },
};

/** Schema version for migration tracking */
export const SCHEMA_VERSION = 1;

// ── AeonDocument ────────────────────────────────────────────────────

export class AeonDocument {
  /** The underlying Yjs document */
  readonly ydoc: Y.Doc;

  /** The top-level XmlFragment containing all blocks */
  readonly fragment: Y.XmlFragment;

  /** Document metadata map */
  readonly meta: Y.Map<unknown>;

  /** Undo manager for local undo/redo */
  readonly undoManager: Y.UndoManager;

  /** Document ID */
  readonly id: string;

  /** Event listeners */
  private listeners: Set<DocumentListener> = new Set();

  constructor(id: string, ydoc?: Y.Doc) {
    this.id = id;
    this.ydoc = ydoc || new Y.Doc();
    this.fragment = this.ydoc.getXmlFragment('document');
    this.meta = this.ydoc.getMap('meta');

    // Initialize metadata
    if (!this.meta.has('schema-version')) {
      this.meta.set('schema-version', SCHEMA_VERSION);
      this.meta.set('created-at', new Date().toISOString());
      this.meta.set('document-id', id);
    }

    // Set up undo manager for all XmlFragment operations
    this.undoManager = new Y.UndoManager(this.fragment, {
      trackedOrigins: new Set([null, 'local']),
    });

    // Observe fragment changes
    this.fragment.observeDeep((events) => {
      for (const event of events) {
        this.handleYjsEvent(event);
      }
    });
  }

  // ── Block Operations ──────────────────────────────────────────

  /**
   * Insert a new block at the given position.
   * Creates an XmlElement in the fragment and links it to an embedding ID.
   */
  insertBlock(
    blockType: string,
    position: number,
    attributes: Record<string, string> = {},
    text?: string
  ): Y.XmlElement {
    // Validate against schema
    const schema = DOCUMENT_SCHEMA[blockType];
    if (!schema) {
      throw new Error(`Unknown block type: ${blockType}`);
    }

    const element = new Y.XmlElement(blockType);

    // Set attributes
    for (const [key, value] of Object.entries(attributes)) {
      element.setAttribute(key, value);
    }

    // Set text content if provided
    if (text) {
      const textNode = new Y.XmlText(text);
      element.insert(0, [textNode]);
    }

    // Insert into fragment
    this.ydoc.transact(() => {
      this.fragment.insert(position, [element]);
    }, 'local');

    return element;
  }

  /** Remove a block by its position */
  removeBlock(position: number): void {
    this.ydoc.transact(() => {
      this.fragment.delete(position, 1);
    }, 'local');
  }

  /** Move a block from one position to another */
  moveBlock(fromPosition: number, toPosition: number): void {
    const element = this.fragment.get(fromPosition);
    if (!(element instanceof Y.XmlElement)) return;

    this.ydoc.transact(() => {
      // Clone attributes and content
      const clone = element.clone();
      this.fragment.delete(fromPosition, 1);

      // Adjust target position if needed
      const adjustedTo =
        toPosition > fromPosition ? toPosition - 1 : toPosition;
      this.fragment.insert(adjustedTo, [clone]);
    }, 'local');
  }

  /** Get a block element by position */
  getBlock(position: number): Y.XmlElement | null {
    const item = this.fragment.get(position);
    return item instanceof Y.XmlElement ? item : null;
  }

  /** Get a block by its ID attribute */
  getBlockById(id: string): Y.XmlElement | null {
    for (let i = 0; i < this.fragment.length; i++) {
      const item = this.fragment.get(i);
      if (item instanceof Y.XmlElement && item.getAttribute('id') === id) {
        return item;
      }
    }
    return null;
  }

  /** Get all blocks */
  getAllBlocks(): Y.XmlElement[] {
    const blocks: Y.XmlElement[] = [];
    for (let i = 0; i < this.fragment.length; i++) {
      const item = this.fragment.get(i);
      if (item instanceof Y.XmlElement) {
        blocks.push(item);
      }
    }
    return blocks;
  }

  /** Get the number of blocks */
  get blockCount(): number {
    return this.fragment.length;
  }

  /** Get the text content of a block */
  getBlockText(position: number): string {
    const block = this.getBlock(position);
    if (!block) return '';
    return block.toString();
  }

  // ── Text Operations ───────────────────────────────────────────

  /**
   * Update the text content of a block.
   * This triggers a CRDT update that syncs to all collaborators
   * and kicks off the embedding pipeline.
   */
  updateBlockText(position: number, newText: string): void {
    const block = this.getBlock(position);
    if (!block) return;

    this.ydoc.transact(() => {
      // Clear existing text nodes
      while (block.length > 0) {
        block.delete(0, 1);
      }
      // Insert new text
      const textNode = new Y.XmlText(newText);
      block.insert(0, [textNode]);
    }, 'local');
  }

  /**
   * Apply an inline mark to a range within a block.
   */
  applyMark(
    position: number,
    start: number,
    end: number,
    mark: InlineMark,
    attrs?: Record<string, string>
  ): void {
    const block = this.getBlock(position);
    if (!block || block.length === 0) return;

    const textNode = block.get(0);
    if (!(textNode instanceof Y.XmlText)) return;

    this.ydoc.transact(() => {
      const markAttrs: Record<string, unknown> = { [mark]: true };
      if (attrs) {
        for (const [key, value] of Object.entries(attrs)) {
          markAttrs[`${mark}-${key}`] = value;
        }
      }
      textNode.format(start, end - start, markAttrs);
    }, 'local');
  }

  /**
   * Remove an inline mark from a range within a block.
   */
  removeMark(
    position: number,
    start: number,
    end: number,
    mark: InlineMark
  ): void {
    const block = this.getBlock(position);
    if (!block || block.length === 0) return;

    const textNode = block.get(0);
    if (!(textNode instanceof Y.XmlText)) return;

    this.ydoc.transact(() => {
      textNode.format(start, end - start, { [mark]: null });
    }, 'local');
  }

  // ── Undo/Redo ─────────────────────────────────────────────────

  /** Undo the last local operation */
  undo(): void {
    this.undoManager.undo();
    this.emit({ type: 'undo' });
  }

  /** Redo the last undone operation */
  redo(): void {
    this.undoManager.redo();
    this.emit({ type: 'redo' });
  }

  /** Whether undo is available */
  get canUndo(): boolean {
    return this.undoManager.undoStack.length > 0;
  }

  /** Whether redo is available */
  get canRedo(): boolean {
    return this.undoManager.redoStack.length > 0;
  }

  // ── Serialization ─────────────────────────────────────────────

  /** Get the full document state as a binary Yjs update */
  getState(): Uint8Array {
    return Y.encodeStateAsUpdate(this.ydoc);
  }

  /** Apply a state update from another collaborator */
  applyUpdate(update: Uint8Array): void {
    Y.applyUpdate(this.ydoc, update);
  }

  /** Get the state vector (for delta sync) */
  getStateVector(): Uint8Array {
    return Y.encodeStateVector(this.ydoc);
  }

  /** Compute a delta update from a state vector */
  getDelta(stateVector: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.ydoc, stateVector);
  }

  /** Export as plain text (all blocks concatenated) */
  toPlainText(): string {
    return this.getAllBlocks()
      .map((block) => block.toString())
      .join('\n\n');
  }

  // ── Events ────────────────────────────────────────────────────

  /** Listen for document change events */
  onChange(listener: DocumentListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Destroy the document and clean up */
  destroy(): void {
    this.undoManager.destroy();
    this.ydoc.destroy();
    this.listeners.clear();
  }

  // ── Private ───────────────────────────────────────────────────

  private handleYjsEvent(event: Y.YEvent<Y.AbstractType<unknown>>): void {
    if (event instanceof Y.YXmlEvent) {
      // Block-level changes
      for (const change of event.changes.added) {
        if (change.content instanceof Y.ContentType) {
          const type = change.content.type;
          if (type instanceof Y.XmlElement) {
            const id = type.getAttribute('id');
            if (id) {
              this.emit({
                type: 'block-inserted',
                blockId: id,
                position: 0, // approximate
              });
            }
          }
        }
      }
      for (const change of event.changes.deleted) {
        if (change.content instanceof Y.ContentType) {
          const type = change.content.type;
          if (type instanceof Y.XmlElement) {
            const id = type.getAttribute('id');
            if (id) {
              this.emit({ type: 'block-removed', blockId: id });
            }
          }
        }
      }
    } else if (event instanceof Y.YTextEvent) {
      // Text-level changes within a block
      const parent = event.target.parent;
      if (parent instanceof Y.XmlElement) {
        const id = parent.getAttribute('id');
        if (id) {
          this.emit({
            type: 'text-changed',
            blockId: id,
            text: parent.toString(),
          });
        }
      }
    }
  }

  private emit(event: DocumentEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
