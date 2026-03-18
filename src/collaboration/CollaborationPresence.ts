/**
 * CollaborationPresence — Multiplayer awareness
 *
 * Medium was solo. Google Docs had cursors but no soul.
 * We need: who's here, where they are, what they're doing,
 * and how their writing FEELS (via embedding proximity).
 *
 * Built on Yjs awareness protocol + embedding context.
 */

import { QDoc, QMap, QArray, QText } from '@a0n/gnosis/crdt';

// ── Types ───────────────────────────────────────────────────────────

export interface Collaborator {
  /** DID of the collaborator */
  readonly did: string;
  /** Display name */
  readonly displayName: string;
  /** Avatar URL */
  readonly avatarUrl?: string;
  /** Assigned color */
  readonly color: string;
  /** Current cursor position */
  cursor: CursorPosition | null;
  /** What they're doing right now */
  activity: CollaboratorActivity;
  /** When they last acted */
  lastActiveAt: number;
  /** Online status */
  status: 'active' | 'idle' | 'away';
}

export interface CursorPosition {
  /** Block ID the cursor is in */
  readonly blockId: string;
  /** Character offset within the block */
  readonly offset: number;
  /** Selection length (0 = caret, >0 = selection) */
  readonly selectionLength: number;
}

export type CollaboratorActivity =
  | { type: 'typing'; blockId: string }
  | { type: 'selecting'; blockId: string; text: string }
  | { type: 'reading'; blockId: string }
  | { type: 'reviewing'; blockId: string }
  | { type: 'idle' }
  | { type: 'using-tool'; tool: string };

export interface PresenceConfig {
  /** The Yjs document */
  readonly ydoc: QDoc;
  /** The local user's DID */
  readonly localDid: string;
  /** The local user's display name */
  readonly localDisplayName: string;
  /** Avatar URL */
  readonly localAvatarUrl?: string;
  /** Idle timeout in ms (default: 60000) */
  readonly idleTimeoutMs?: number;
  /** Away timeout in ms (default: 300000) */
  readonly awayTimeoutMs?: number;
}

// ── Palette ─────────────────────────────────────────────────────────

const COLLABORATOR_COLORS = [
  '#6e56cf',
  '#3b9aea',
  '#e54666',
  '#f59e0b',
  '#10b981',
  '#f97316',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#84cc16',
];

// ── Presence Engine ─────────────────────────────────────────────────

export class CollaborationPresence {
  private config: PresenceConfig;
  private awareness: any; // Y.Awareness
  private collaborators: Map<string, Collaborator> = new Map();
  private listeners: Set<(collaborators: Collaborator[]) => void> = new Set();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private colorIndex = 0;

  constructor(config: PresenceConfig) {
    this.config = config;
  }

  /**
   * Connect to awareness and start broadcasting presence.
   */
  connect(awareness: any): void {
    this.awareness = awareness;

    // Set local state
    const color =
      COLLABORATOR_COLORS[this.colorIndex++ % COLLABORATOR_COLORS.length];
    awareness.setLocalStateField('user', {
      did: this.config.localDid,
      displayName: this.config.localDisplayName,
      avatarUrl: this.config.localAvatarUrl,
      color,
      cursor: null,
      activity: { type: 'idle' },
      lastActiveAt: Date.now(),
      status: 'active',
    });

    // Listen for changes
    awareness.on('change', () => {
      this.syncCollaborators();
    });

    this.syncCollaborators();
  }

  /**
   * Update the local cursor position.
   */
  setCursor(position: CursorPosition | null): void {
    if (!this.awareness) return;
    const state = this.awareness.getLocalState()?.user;
    if (!state) return;

    this.awareness.setLocalStateField('user', {
      ...state,
      cursor: position,
      lastActiveAt: Date.now(),
      status: 'active',
    });

    this.resetIdleTimer();
  }

  /**
   * Update the local activity.
   */
  setActivity(activity: CollaboratorActivity): void {
    if (!this.awareness) return;
    const state = this.awareness.getLocalState()?.user;
    if (!state) return;

    this.awareness.setLocalStateField('user', {
      ...state,
      activity,
      lastActiveAt: Date.now(),
      status: 'active',
    });

    this.resetIdleTimer();
  }

  /**
   * Get all collaborators (excluding self).
   */
  getCollaborators(): Collaborator[] {
    return Array.from(this.collaborators.values());
  }

  /**
   * Get collaborators in a specific block.
   */
  getCollaboratorsInBlock(blockId: string): Collaborator[] {
    return this.getCollaborators().filter((c) => c.cursor?.blockId === blockId);
  }

  /**
   * Listen for collaborator changes.
   */
  onChange(listener: (collaborators: Collaborator[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Disconnect and clean up.
   */
  disconnect(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.awareness?.setLocalState(null);
    this.collaborators.clear();
    this.listeners.clear();
  }

  // ── Private ───────────────────────────────────────────────────

  private syncCollaborators(): void {
    if (!this.awareness) return;

    const states = this.awareness.getStates();
    this.collaborators.clear();

    states.forEach((state: any, clientId: number) => {
      const user = state.user;
      if (!user || user.did === this.config.localDid) return;

      // Check idle/away
      const elapsed = Date.now() - user.lastActiveAt;
      const idleTimeout = this.config.idleTimeoutMs ?? 60000;
      const awayTimeout = this.config.awayTimeoutMs ?? 300000;

      let status: Collaborator['status'] = 'active';
      if (elapsed > awayTimeout) status = 'away';
      else if (elapsed > idleTimeout) status = 'idle';

      this.collaborators.set(user.did, {
        ...user,
        status,
      });
    });

    this.notifyListeners();
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const idleTimeout = this.config.idleTimeoutMs ?? 60000;

    this.idleTimer = setTimeout(() => {
      if (!this.awareness) return;
      const state = this.awareness.getLocalState()?.user;
      if (!state) return;

      this.awareness.setLocalStateField('user', {
        ...state,
        status: 'idle',
        activity: { type: 'idle' },
      });
    }, idleTimeout);
  }

  private notifyListeners(): void {
    const list = this.getCollaborators();
    for (const listener of this.listeners) {
      listener(list);
    }
  }
}
