/**
 * RevisionManager — CRDT-native revision system
 *
 * Better than git because it operates on structured document trees,
 * not text diffs. Every keystroke is a CRDT operation — lossless
 * undo/redo at any granularity. Supports rollback, rollforward,
 * branching, merge, cherry-pick, and time-travel.
 */

import * as Y from 'yjs';
import type { AeonDocument } from '../document/document';

// ── Types ───────────────────────────────────────────────────────────

/** A named revision (snapshot) */
export interface Revision {
  /** Unique revision ID */
  readonly id: string;
  /** User-provided label (or auto-generated) */
  readonly label: string;
  /** DID of the author who created this revision */
  readonly authorDid: string;
  /** ISO-8601 timestamp */
  readonly createdAt: string;
  /** Yjs state vector at this point */
  readonly stateVector: Uint8Array;
  /** Full Yjs state snapshot (for restoration) */
  readonly snapshot: Uint8Array;
  /** Branch this revision belongs to */
  readonly branch: string;
  /** Parent revision ID (null for initial) */
  readonly parentId: string | null;
  /** Summary of changes from parent */
  readonly changeSummary?: string;
}

/** A branch in the revision tree */
export interface Branch {
  /** Branch name */
  readonly name: string;
  /** Timestamp when branch was created */
  readonly createdAt: string;
  /** Revision ID where this branch forked */
  readonly forkPoint: string;
  /** Latest revision ID on this branch */
  readonly head: string;
  /** Whether this is the document's main branch */
  readonly isMain: boolean;
}

/** Structural diff between two revisions */
export interface RevisionDiff {
  /** Added blocks */
  readonly added: DiffBlock[];
  /** Removed blocks */
  readonly removed: DiffBlock[];
  /** Modified blocks */
  readonly modified: DiffModification[];
  /** Moved blocks (same content, different position) */
  readonly moved: DiffMove[];
}

/** A block in a diff */
export interface DiffBlock {
  readonly blockId: string;
  readonly blockType: string;
  readonly text: string;
  readonly position: number;
}

/** A modification in a diff */
export interface DiffModification {
  readonly blockId: string;
  readonly blockType: string;
  readonly oldText: string;
  readonly newText: string;
  readonly position: number;
}

/** A block that moved position */
export interface DiffMove {
  readonly blockId: string;
  readonly blockType: string;
  readonly oldPosition: number;
  readonly newPosition: number;
}

/** Blame entry — who wrote each block */
export interface BlameEntry {
  readonly blockId: string;
  readonly authorDid: string;
  readonly revisionId: string;
  readonly timestamp: string;
}

/** Revision event */
export type RevisionEvent =
  | { type: 'revision-created'; revision: Revision }
  | { type: 'branch-created'; branch: Branch }
  | { type: 'rollback'; targetRevisionId: string }
  | { type: 'rollforward'; targetRevisionId: string }
  | { type: 'merge'; sourceBranch: string; targetBranch: string }
  | { type: 'cherry-pick'; revisionId: string; targetBranch: string };

export type RevisionListener = (event: RevisionEvent) => void;

// ── Revision Manager ────────────────────────────────────────────────

export class RevisionManager {
  /** All revisions, ordered by creation time */
  private revisions: Map<string, Revision> = new Map();

  /** All branches */
  private branches: Map<string, Branch> = new Map();

  /** Current branch name */
  private currentBranch: string = 'main';

  /** Auto-snapshot debounce timer */
  private autoSnapshotTimer: ReturnType<typeof setTimeout> | null = null;

  /** Auto-snapshot interval (ms) */
  private readonly autoSnapshotIntervalMs: number;

  /** Change counter since last auto-snapshot */
  private changesSinceSnapshot: number = 0;

  /** Change threshold for auto-snapshot */
  private readonly autoSnapshotThreshold: number;

  /** Event listeners */
  private listeners: Set<RevisionListener> = new Set();

  /** Generate unique IDs */
  private readonly generateId: () => string;

  constructor(
    generateId: () => string,
    options: {
      autoSnapshotIntervalMs?: number;
      autoSnapshotThreshold?: number;
    } = {}
  ) {
    this.generateId = generateId;
    this.autoSnapshotIntervalMs = options.autoSnapshotIntervalMs ?? 30000;
    this.autoSnapshotThreshold = options.autoSnapshotThreshold ?? 50;

    // Initialize main branch
    this.branches.set('main', {
      name: 'main',
      createdAt: new Date().toISOString(),
      forkPoint: '',
      head: '',
      isMain: true,
    });
  }

  // ── Core Operations ───────────────────────────────────────────

  /**
   * Create a named revision (snapshot) of the current document state.
   */
  createRevision(
    doc: AeonDocument,
    label?: string,
    authorDid: string = 'local'
  ): Revision {
    const branch = this.branches.get(this.currentBranch)!;
    const id = this.generateId();

    const revision: Revision = {
      id,
      label: label || `Auto-save ${new Date().toLocaleString()}`,
      authorDid,
      createdAt: new Date().toISOString(),
      stateVector: doc.getStateVector(),
      snapshot: doc.getState(),
      branch: this.currentBranch,
      parentId: branch.head || null,
    };

    this.revisions.set(id, revision);

    // Update branch head
    this.branches.set(this.currentBranch, {
      ...branch,
      head: id,
    });

    this.changesSinceSnapshot = 0;
    this.emit({ type: 'revision-created', revision });

    return revision;
  }

  /**
   * Rollback to a specific revision.
   * Creates a NEW revision that represents the rollback
   * (non-destructive — you can always rollforward).
   */
  rollbackTo(
    revisionId: string,
    doc: AeonDocument,
    authorDid: string = 'local'
  ): Revision | null {
    const targetRevision = this.revisions.get(revisionId);
    if (!targetRevision) return null;

    // Save current state first (so we can rollforward)
    this.createRevision(
      doc,
      `Pre-rollback to "${targetRevision.label}"`,
      authorDid
    );

    // Create a new Y.Doc and apply the target snapshot
    const restoredDoc = new Y.Doc();
    Y.applyUpdate(restoredDoc, targetRevision.snapshot);

    // Apply the restored state as an update to the current doc
    const restoredState = Y.encodeStateAsUpdate(restoredDoc);
    doc.applyUpdate(restoredState);
    restoredDoc.destroy();

    // Create a revision marking the rollback
    const rollbackRevision = this.createRevision(
      doc,
      `Rolled back to "${targetRevision.label}"`,
      authorDid
    );

    this.emit({ type: 'rollback', targetRevisionId: revisionId });
    return rollbackRevision;
  }

  /**
   * Rollforward — re-apply CRDT ops from rollback point to target.
   */
  rollforwardTo(
    revisionId: string,
    doc: AeonDocument,
    authorDid: string = 'local'
  ): Revision | null {
    const targetRevision = this.revisions.get(revisionId);
    if (!targetRevision) return null;

    // Apply the target state
    doc.applyUpdate(targetRevision.snapshot);

    const rollforwardRevision = this.createRevision(
      doc,
      `Rolled forward to "${targetRevision.label}"`,
      authorDid
    );

    this.emit({ type: 'rollforward', targetRevisionId: revisionId });
    return rollforwardRevision;
  }

  // ── Branching ─────────────────────────────────────────────────

  /**
   * Fork the current revision into a new branch.
   */
  createBranch(name: string, fromRevisionId?: string): Branch {
    const forkPoint =
      fromRevisionId || this.branches.get(this.currentBranch)?.head || '';

    const branch: Branch = {
      name,
      createdAt: new Date().toISOString(),
      forkPoint,
      head: forkPoint,
      isMain: false,
    };

    this.branches.set(name, branch);
    this.emit({ type: 'branch-created', branch });
    return branch;
  }

  /**
   * Switch to a different branch.
   * Caller is responsible for applying the branch head's snapshot to the doc.
   */
  switchBranch(name: string): Branch | null {
    const branch = this.branches.get(name);
    if (!branch) return null;
    this.currentBranch = name;
    return branch;
  }

  /**
   * Merge a source branch into the current branch.
   * Uses structural merge via CRDT — no merge conflicts
   * on non-overlapping changes because CRDT operations commute.
   */
  merge(
    sourceBranch: string,
    doc: AeonDocument,
    authorDid: string = 'local'
  ): Revision | null {
    const source = this.branches.get(sourceBranch);
    if (!source) return null;

    const sourceHead = this.revisions.get(source.head);
    if (!sourceHead) return null;

    // CRDT merge: just apply the source snapshot as an update
    // Yjs handles conflict resolution automatically
    doc.applyUpdate(sourceHead.snapshot);

    const mergeRevision = this.createRevision(
      doc,
      `Merged "${sourceBranch}" into "${this.currentBranch}"`,
      authorDid
    );

    this.emit({
      type: 'merge',
      sourceBranch,
      targetBranch: this.currentBranch,
    });

    return mergeRevision;
  }

  /**
   * Cherry-pick a specific revision's changes and apply to current branch.
   */
  cherryPick(
    revisionId: string,
    doc: AeonDocument,
    authorDid: string = 'local'
  ): Revision | null {
    const revision = this.revisions.get(revisionId);
    if (!revision) return null;

    // Get the parent revision to compute the delta
    if (revision.parentId) {
      const parentRevision = this.revisions.get(revision.parentId);
      if (parentRevision) {
        // Compute the delta between parent and this revision
        const tempDoc = new Y.Doc();
        Y.applyUpdate(tempDoc, parentRevision.snapshot);
        const stateVector = Y.encodeStateVector(tempDoc);
        tempDoc.destroy();

        // Get only the changes from this specific revision
        const delta = new Y.Doc();
        Y.applyUpdate(delta, revision.snapshot);
        const changes = Y.encodeStateAsUpdate(delta, stateVector);
        delta.destroy();

        // Apply just those changes to the current document
        doc.applyUpdate(changes);
      }
    }

    const cherryPickRevision = this.createRevision(
      doc,
      `Cherry-picked "${revision.label}" from ${revision.branch}`,
      authorDid
    );

    this.emit({
      type: 'cherry-pick',
      revisionId,
      targetBranch: this.currentBranch,
    });

    return cherryPickRevision;
  }

  // ── Queries ───────────────────────────────────────────────────

  /** List all revisions on the current branch */
  listRevisions(branch?: string): Revision[] {
    const branchName = branch || this.currentBranch;
    return Array.from(this.revisions.values())
      .filter((r) => r.branch === branchName)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
  }

  /** Get a specific revision */
  getRevision(id: string): Revision | undefined {
    return this.revisions.get(id);
  }

  /** List all branches */
  listBranches(): Branch[] {
    return Array.from(this.branches.values());
  }

  /** Get the current branch */
  getCurrentBranch(): Branch {
    return this.branches.get(this.currentBranch)!;
  }

  /**
   * Compute a structural diff between two revisions.
   * Unlike git's line-based diff, this understands document structure.
   */
  diffRevisions(revIdA: string, revIdB: string): RevisionDiff | null {
    const revA = this.revisions.get(revIdA);
    const revB = this.revisions.get(revIdB);
    if (!revA || !revB) return null;

    // Reconstruct both documents
    const docA = new Y.Doc();
    Y.applyUpdate(docA, revA.snapshot);
    const fragA = docA.getXmlFragment('document');

    const docB = new Y.Doc();
    Y.applyUpdate(docB, revB.snapshot);
    const fragB = docB.getXmlFragment('document');

    // Extract blocks from both
    const blocksA = extractBlocks(fragA);
    const blocksB = extractBlocks(fragB);

    // Compare
    const diff = computeStructuralDiff(blocksA, blocksB);

    docA.destroy();
    docB.destroy();

    return diff;
  }

  /**
   * Get blame information — who wrote each block.
   */
  getBlame(): BlameEntry[] {
    // Build blame from revision history
    const blame = new Map<string, BlameEntry>();

    const revisions = this.listRevisions().reverse(); // oldest first
    for (const revision of revisions) {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, revision.snapshot);
      const fragment = doc.getXmlFragment('document');

      for (let i = 0; i < fragment.length; i++) {
        const item = fragment.get(i);
        if (item instanceof Y.XmlElement) {
          const blockId = item.getAttribute('id');
          if (blockId) {
            blame.set(blockId, {
              blockId,
              authorDid: revision.authorDid,
              revisionId: revision.id,
              timestamp: revision.createdAt,
            });
          }
        }
      }

      doc.destroy();
    }

    return Array.from(blame.values());
  }

  // ── Auto-snapshot ─────────────────────────────────────────────

  /**
   * Record a change for auto-snapshot tracking.
   * Call this on every CRDT operation.
   */
  recordChange(doc: AeonDocument, authorDid: string = 'local'): void {
    this.changesSinceSnapshot++;

    if (this.changesSinceSnapshot >= this.autoSnapshotThreshold) {
      this.createRevision(doc, undefined, authorDid);
      return;
    }

    // Reset debounce timer
    if (this.autoSnapshotTimer) {
      clearTimeout(this.autoSnapshotTimer);
    }
    this.autoSnapshotTimer = setTimeout(() => {
      if (this.changesSinceSnapshot > 0) {
        this.createRevision(doc, undefined, authorDid);
      }
    }, this.autoSnapshotIntervalMs);
  }

  // ── Events ────────────────────────────────────────────────────

  onEvent(listener: RevisionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Clean up timers */
  dispose(): void {
    if (this.autoSnapshotTimer) {
      clearTimeout(this.autoSnapshotTimer);
    }
    this.listeners.clear();
  }

  // ── Private ───────────────────────────────────────────────────

  private emit(event: RevisionEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

// ── Diff Helpers ────────────────────────────────────────────────────

interface BlockSnapshot {
  id: string;
  type: string;
  text: string;
  position: number;
}

function extractBlocks(fragment: Y.XmlFragment): BlockSnapshot[] {
  const blocks: BlockSnapshot[] = [];
  for (let i = 0; i < fragment.length; i++) {
    const item = fragment.get(i);
    if (item instanceof Y.XmlElement) {
      blocks.push({
        id: item.getAttribute('id') || `pos-${i}`,
        type: item.nodeName,
        text: item.toString(),
        position: i,
      });
    }
  }
  return blocks;
}

function computeStructuralDiff(
  blocksA: BlockSnapshot[],
  blocksB: BlockSnapshot[]
): RevisionDiff {
  const idsA = new Set(blocksA.map((b) => b.id));
  const idsB = new Set(blocksB.map((b) => b.id));
  const mapA = new Map(blocksA.map((b) => [b.id, b]));
  const mapB = new Map(blocksB.map((b) => [b.id, b]));

  const added: DiffBlock[] = [];
  const removed: DiffBlock[] = [];
  const modified: DiffModification[] = [];
  const moved: DiffMove[] = [];

  // Find added blocks (in B but not in A)
  for (const block of blocksB) {
    if (!idsA.has(block.id)) {
      added.push({
        blockId: block.id,
        blockType: block.type,
        text: block.text,
        position: block.position,
      });
    }
  }

  // Find removed blocks (in A but not in B)
  for (const block of blocksA) {
    if (!idsB.has(block.id)) {
      removed.push({
        blockId: block.id,
        blockType: block.type,
        text: block.text,
        position: block.position,
      });
    }
  }

  // Find modified and moved blocks
  for (const block of blocksB) {
    const counterpart = mapA.get(block.id);
    if (!counterpart) continue;

    if (counterpart.text !== block.text) {
      modified.push({
        blockId: block.id,
        blockType: block.type,
        oldText: counterpart.text,
        newText: block.text,
        position: block.position,
      });
    }

    if (counterpart.position !== block.position) {
      moved.push({
        blockId: block.id,
        blockType: block.type,
        oldPosition: counterpart.position,
        newPosition: block.position,
      });
    }
  }

  return { added, removed, modified, moved };
}
