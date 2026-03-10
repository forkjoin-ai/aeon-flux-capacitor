/**
 * DevMode — Turn any Aeon page into an in-place Capacitor editor
 *
 * An Aeon page is a data object. It's filesystem-free until you
 * need to write that tree back. DevMode enables:
 *
 *   1. Any page → editable surface (Capacitor mounts over the page)
 *   2. Save → re-renders the page from the new CRDT state
 *   3. Dev mode → writes the tree back to disk
 *
 * The page doesn't "have" an editor — the page IS the editor.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';

// ── Types ───────────────────────────────────────────────────────────

export interface DevModeConfig {
  /** Enable dev mode (writes back to disk) */
  readonly devMode: boolean;
  /** Keyboard shortcut to toggle editing (default: Ctrl+Shift+E) */
  readonly toggleShortcut?: string;
  /** API endpoint for writing the tree back to disk */
  readonly writeEndpoint?: string;
  /** API endpoint for re-rendering the page */
  readonly renderEndpoint?: string;
  /** Auth token provider */
  readonly getToken?: () => Promise<string>;
  /** Show visual indicator when in edit mode */
  readonly showEditIndicator?: boolean;
  /** Auto-save debounce interval in ms */
  readonly autoSaveMs?: number;
  /** Callback when editing starts */
  readonly onEditStart?: () => void;
  /** Callback when editing ends */
  readonly onEditEnd?: () => void;
  /** Callback when page is saved */
  readonly onSave?: (result: SaveResult) => void;
}

export interface SaveResult {
  /** Whether the save was successful */
  readonly success: boolean;
  /** Whether the page was re-rendered */
  readonly reRendered: boolean;
  /** Whether the tree was written to disk (dev mode) */
  readonly writtenToDisk: boolean;
  /** Error message if save failed */
  readonly error?: string;
  /** Timestamp */
  readonly timestamp: string;
}

export interface PageDataObject {
  /** The page's unique ID */
  readonly id: string;
  /** The page's route/path */
  readonly route: string;
  /** The CRDT state (Yjs update vector) */
  readonly state: Uint8Array;
  /** Embedding document snapshot */
  readonly embeddingSnapshot?: unknown;
  /** Page metadata */
  readonly meta: Record<string, unknown>;
}

// ── DevMode Controller ──────────────────────────────────────────────

export class DevModeController {
  private config: DevModeConfig;
  private editing = false;
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners: Set<(editing: boolean) => void> = new Set();

  constructor(config: DevModeConfig) {
    this.config = config;
    this.setupKeyboardShortcut();
  }

  /** Whether editing is currently active */
  isEditing(): boolean {
    return this.editing;
  }

  /** Whether dev mode is enabled (writes to disk) */
  isDevMode(): boolean {
    return this.config.devMode;
  }

  /** Start editing the current page */
  startEditing(): void {
    if (this.editing) return;
    this.editing = true;
    document.body.classList.add('afc-devmode-editing');
    this.config.onEditStart?.();
    this.notifyListeners();
  }

  /** Stop editing, save, and re-render */
  async stopEditing(): Promise<SaveResult> {
    if (!this.editing) {
      return {
        success: true,
        reRendered: false,
        writtenToDisk: false,
        timestamp: new Date().toISOString(),
      };
    }

    this.editing = false;
    document.body.classList.remove('afc-devmode-editing');
    this.config.onEditEnd?.();
    this.notifyListeners();

    const result = await this.save();
    return result;
  }

  /** Toggle editing state */
  async toggle(): Promise<void> {
    if (this.editing) {
      await this.stopEditing();
    } else {
      this.startEditing();
    }
  }

  /** Save the current state */
  async save(): Promise<SaveResult> {
    const timestamp = new Date().toISOString();

    try {
      // Step 1: Re-render the page from the new CRDT state
      let reRendered = false;
      if (this.config.renderEndpoint) {
        const token = await this.config.getToken?.();
        const res = await fetch(this.config.renderEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ timestamp }),
        });
        reRendered = res.ok;
      }

      // Step 2: In dev mode, write the tree back to disk
      let writtenToDisk = false;
      if (this.config.devMode && this.config.writeEndpoint) {
        const token = await this.config.getToken?.();
        const res = await fetch(this.config.writeEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ timestamp, writeToDisk: true }),
        });
        writtenToDisk = res.ok;
      }

      const result: SaveResult = {
        success: true,
        reRendered,
        writtenToDisk,
        timestamp,
      };
      this.config.onSave?.(result);
      return result;
    } catch (err) {
      const result: SaveResult = {
        success: false,
        reRendered: false,
        writtenToDisk: false,
        error: err instanceof Error ? err.message : String(err),
        timestamp,
      };
      this.config.onSave?.(result);
      return result;
    }
  }

  /** Listen for editing state changes */
  onEditingChange(listener: (editing: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Schedule auto-save (debounced) */
  scheduleAutoSave(): void {
    if (!this.config.autoSaveMs) return;
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = setTimeout(() => {
      this.save();
    }, this.config.autoSaveMs);
  }

  /** Clean up */
  destroy(): void {
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.listeners.clear();
  }

  // ── Private ───────────────────────────────────────────────────

  private setupKeyboardShortcut(): void {
    const handler = (e: KeyboardEvent) => {
      // Default: Ctrl+Shift+E
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        this.toggle();
      }
      // Ctrl+S to save while editing
      if (this.editing && (e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        this.save();
      }
    };
    window.addEventListener('keydown', handler);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.editing);
    }
  }
}

// ── React Hook ──────────────────────────────────────────────────────

/**
 * Hook to use DevMode in a component.
 * Provides editing state and controls.
 */
export function useDevMode(config: DevModeConfig): {
  editing: boolean;
  devMode: boolean;
  startEditing: () => void;
  stopEditing: () => Promise<SaveResult>;
  toggle: () => Promise<void>;
  save: () => Promise<SaveResult>;
} {
  const controllerRef = useRef<DevModeController | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const controller = new DevModeController(config);
    controllerRef.current = controller;
    const unsub = controller.onEditingChange(setEditing);
    return () => {
      unsub();
      controller.destroy();
    };
  }, [config.devMode]);

  return {
    editing,
    devMode: config.devMode,
    startEditing: () => controllerRef.current?.startEditing(),
    stopEditing: () =>
      controllerRef.current?.stopEditing() ??
      Promise.resolve({
        success: false,
        reRendered: false,
        writtenToDisk: false,
        timestamp: new Date().toISOString(),
      }),
    toggle: () => controllerRef.current?.toggle() ?? Promise.resolve(),
    save: () =>
      controllerRef.current?.save() ??
      Promise.resolve({
        success: false,
        reRendered: false,
        writtenToDisk: false,
        timestamp: new Date().toISOString(),
      }),
  };
}

// ── DevMode Indicator Component ─────────────────────────────────────

export interface DevModeIndicatorProps {
  editing: boolean;
  devMode: boolean;
  onToggle: () => void;
  onSave: () => void;
}

/**
 * Floating pill indicator that shows when the page is in edit mode.
 * Minimal, always latent, instant.
 */
export const DevModeIndicator: React.FC<DevModeIndicatorProps> = ({
  editing,
  devMode,
  onToggle,
  onSave,
}) => {
  if (!editing) {
    // Latent indicator — small, unobtrusive
    return (
      <button
        className="afc-devmode-trigger"
        onClick={onToggle}
        title="Edit this page (Ctrl+Shift+E)"
        aria-label="Toggle page editing"
      >
        ✎
      </button>
    );
  }

  return (
    <div className="afc-devmode-bar">
      <span className="afc-devmode-status">
        <span className="afc-devmode-dot" />
        Editing
        {devMode && <span className="afc-devmode-badge">DEV</span>}
      </span>
      <div className="afc-devmode-actions">
        <button
          className="afc-devmode-btn"
          onClick={onSave}
          title="Save (Ctrl+S)"
        >
          Save
        </button>
        <button
          className="afc-devmode-btn afc-devmode-btn-done"
          onClick={onToggle}
          title="Done editing (Ctrl+Shift+E)"
        >
          Done
        </button>
      </div>
    </div>
  );
};
