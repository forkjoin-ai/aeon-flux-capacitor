/**
 * InlineComments — Threaded discussions anchored to text ranges
 *
 * Google Docs has comments. Medium has highlights.
 * We anchor comments to embedding ranges, not character offsets.
 *
 * When text moves, reflows, or is edited, the comment stays
 * attached to the MEANING, not the position. Because the
 * anchor is an embedding, not a byte offset.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';

// ── Types ───────────────────────────────────────────────────────────

export interface InlineComment {
  /** Unique comment ID */
  readonly id: string;
  /** Author DID */
  readonly authorDid: string;
  /** Author display name */
  readonly authorName: string;
  /** Author avatar URL */
  readonly authorAvatarUrl?: string;
  /** Comment text */
  readonly body: string;
  /** Attached to this block */
  readonly blockId: string;
  /** Text range anchor — the selected text the comment was made on */
  readonly anchorText: string;
  /** Embedding of the anchor text (for reattachment after edits) */
  readonly anchorEmbedding?: Float32Array;
  /** Thread parent ID (null = top-level) */
  readonly parentId: string | null;
  /** State */
  state: CommentState;
  /** Timestamps */
  readonly createdAt: string;
  readonly resolvedAt?: string;
  /** Reactions */
  readonly reactions: CommentReaction[];
}

export type CommentState = 'active' | 'resolved' | 'archived';

export interface CommentReaction {
  readonly emoji: string;
  readonly authorDid: string;
  readonly createdAt: string;
}

export interface SuggestedEdit {
  /** Suggested edit ID */
  readonly id: string;
  /** Author DID */
  readonly authorDid: string;
  /** Author display name */
  readonly authorName: string;
  /** Block this edit applies to */
  readonly blockId: string;
  /** Original text */
  readonly originalText: string;
  /** Suggested replacement text */
  readonly suggestedText: string;
  /** Explanation */
  readonly reason?: string;
  /** State */
  state: 'pending' | 'accepted' | 'rejected';
  /** Timestamp */
  readonly createdAt: string;
}

export interface CommentThreadConfig {
  /** Local user's DID */
  readonly localDid: string;
  /** Local user's display name */
  readonly localDisplayName: string;
  /** Local user's avatar */
  readonly localAvatarUrl?: string;
  /** Function to generate unique IDs */
  readonly generateId: () => string;
  /** Optional: inference function for auto-resolving similar comments */
  readonly inferFn?: (prompt: string) => Promise<string>;
}

// ── Comment Manager ─────────────────────────────────────────────────

export class CommentManager {
  private config: CommentThreadConfig;
  private comments: Map<string, InlineComment> = new Map();
  private suggestedEdits: Map<string, SuggestedEdit> = new Map();
  private listeners: Set<() => void> = new Set();

  constructor(config: CommentThreadConfig) {
    this.config = config;
  }

  /**
   * Add a new comment on a text range.
   */
  addComment(params: {
    blockId: string;
    anchorText: string;
    anchorEmbedding?: Float32Array;
    body: string;
    parentId?: string;
  }): InlineComment {
    const comment: InlineComment = {
      id: this.config.generateId(),
      authorDid: this.config.localDid,
      authorName: this.config.localDisplayName,
      authorAvatarUrl: this.config.localAvatarUrl,
      body: params.body,
      blockId: params.blockId,
      anchorText: params.anchorText,
      anchorEmbedding: params.anchorEmbedding,
      parentId: params.parentId ?? null,
      state: 'active',
      createdAt: new Date().toISOString(),
      reactions: [],
    };

    this.comments.set(comment.id, comment);
    this.notify();
    return comment;
  }

  /**
   * Reply to a comment (threaded discussion).
   */
  reply(parentId: string, body: string): InlineComment | null {
    const parent = this.comments.get(parentId);
    if (!parent) return null;

    return this.addComment({
      blockId: parent.blockId,
      anchorText: parent.anchorText,
      anchorEmbedding: parent.anchorEmbedding,
      body,
      parentId,
    });
  }

  /**
   * Resolve a comment thread.
   */
  resolve(commentId: string): void {
    const comment = this.comments.get(commentId);
    if (!comment) return;

    comment.state = 'resolved';
    (comment as { resolvedAt?: string }).resolvedAt = new Date().toISOString();

    // Also resolve all children
    for (const [, child] of this.comments) {
      if (child.parentId === commentId) {
        child.state = 'resolved';
      }
    }
    this.notify();
  }

  /**
   * Add a reaction to a comment.
   */
  react(commentId: string, emoji: string): void {
    const comment = this.comments.get(commentId);
    if (!comment) return;

    const existing = comment.reactions.findIndex(
      (r) => r.authorDid === this.config.localDid && r.emoji === emoji
    );

    if (existing >= 0) {
      // Toggle off
      (comment.reactions as CommentReaction[]).splice(existing, 1);
    } else {
      (comment.reactions as CommentReaction[]).push({
        emoji,
        authorDid: this.config.localDid,
        createdAt: new Date().toISOString(),
      });
    }
    this.notify();
  }

  /**
   * Suggest an edit (like Google Docs suggestion mode).
   */
  suggestEdit(params: {
    blockId: string;
    originalText: string;
    suggestedText: string;
    reason?: string;
  }): SuggestedEdit {
    const edit: SuggestedEdit = {
      id: this.config.generateId(),
      authorDid: this.config.localDid,
      authorName: this.config.localDisplayName,
      blockId: params.blockId,
      originalText: params.originalText,
      suggestedText: params.suggestedText,
      reason: params.reason,
      state: 'pending',
      createdAt: new Date().toISOString(),
    };

    this.suggestedEdits.set(edit.id, edit);
    this.notify();
    return edit;
  }

  /**
   * Accept a suggested edit.
   */
  acceptEdit(editId: string): SuggestedEdit | null {
    const edit = this.suggestedEdits.get(editId);
    if (!edit) return null;
    edit.state = 'accepted';
    this.notify();
    return edit;
  }

  /**
   * Reject a suggested edit.
   */
  rejectEdit(editId: string): void {
    const edit = this.suggestedEdits.get(editId);
    if (edit) {
      edit.state = 'rejected';
      this.notify();
    }
  }

  /**
   * Get all comments for a block.
   */
  getCommentsForBlock(blockId: string): InlineComment[] {
    return Array.from(this.comments.values())
      .filter((c) => c.blockId === blockId && c.parentId === null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * Get the thread for a comment (all replies).
   */
  getThread(commentId: string): InlineComment[] {
    const root = this.comments.get(commentId);
    if (!root) return [];

    const replies = Array.from(this.comments.values())
      .filter((c) => c.parentId === commentId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    return [root, ...replies];
  }

  /**
   * Get pending suggested edits for a block.
   */
  getSuggestedEdits(blockId: string): SuggestedEdit[] {
    return Array.from(this.suggestedEdits.values()).filter(
      (e) => e.blockId === blockId && e.state === 'pending'
    );
  }

  /**
   * Get unresolved comment count.
   */
  getUnresolvedCount(): number {
    return Array.from(this.comments.values()).filter(
      (c) => c.state === 'active' && c.parentId === null
    ).length;
  }

  /**
   * Listen for changes.
   */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── Private ───────────────────────────────────────────────────

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
