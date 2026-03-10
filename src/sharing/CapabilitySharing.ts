/**
 * CapabilitySharing — UCAN-native sharing with group support
 *
 * UCAN is individual-to-individual delegation. But editors need groups,
 * teams, "anyone with the link" semantics. This module bridges UCAN
 * capabilities with practical sharing patterns via resource URIs.
 *
 * Permissions are encoded into the resource URI itself:
 *   aeon://doc/{docId}/block/{blockId}?cap=edit&group=team-alpha
 *   aeon://doc/{docId}?cap=read&expires=2026-03-01
 *   aeon://doc/{docId}?cap=comment&audience=reviewers
 *
 * Groups are implemented as UCAN delegation chains:
 *   - A group is a DID that delegates to its members
 *   - Group membership is a UCAN from the group DID to the member DID
 *   - Capabilities flow: owner → group DID → member DIDs
 */

// ── Types ───────────────────────────────────────────────────────────

export type Capability =
  | 'read'
  | 'comment'
  | 'suggest'
  | 'edit'
  | 'admin'
  | 'publish';

/** Capability levels are hierarchical: admin > publish > edit > suggest > comment > read */
const CAPABILITY_HIERARCHY: Capability[] = [
  'read',
  'comment',
  'suggest',
  'edit',
  'publish',
  'admin',
];

export interface ShareLink {
  /** The capability URI */
  readonly uri: string;
  /** Document ID */
  readonly documentId: string;
  /** Block ID (null = whole document) */
  readonly blockId: string | null;
  /** Maximum capability granted */
  readonly capability: Capability;
  /** Who can use this link */
  readonly audience: ShareAudience;
  /** Expiration (null = never) */
  readonly expiresAt: string | null;
  /** UCAN token backing this share */
  readonly ucan: string;
  /** Whether the link is currently active */
  active: boolean;
  /** Number of times the link has been used */
  uses: number;
  /** Maximum uses (null = unlimited) */
  readonly maxUses: number | null;
  /** Created timestamp */
  readonly createdAt: string;
  /** Creator DID */
  readonly creatorDid: string;
}

export type ShareAudience =
  | { type: 'anyone' } // anyone with the link
  | { type: 'did'; did: string } // specific DID
  | { type: 'group'; groupId: string } // group members
  | { type: 'email'; email: string } // email address (resolved to DID on claim)
  | { type: 'domain'; domain: string }; // anyone with @domain email

export interface Group {
  /** Group ID (also its DID) */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Description */
  readonly description: string;
  /** Members */
  readonly members: GroupMember[];
  /** Creator DID */
  readonly createdBy: string;
  /** Created timestamp */
  readonly createdAt: string;
  /** Default capability for new members */
  readonly defaultCapability: Capability;
}

export interface GroupMember {
  /** Member DID */
  readonly did: string;
  /** Display name */
  readonly name: string;
  /** Capability level within the group */
  readonly capability: Capability;
  /** When they joined */
  readonly joinedAt: string;
  /** UCAN delegation token for this membership */
  readonly delegationUcan: string;
}

export interface CapabilityGrant {
  /** Who is granting */
  readonly issuer: string;
  /** Who receives */
  readonly audience: string;
  /** What resource */
  readonly resource: string;
  /** What capability */
  readonly capability: Capability;
  /** Caveats/constraints */
  readonly caveats: GrantCaveat[];
  /** Expiration */
  readonly expiresAt: string | null;
  /** UCAN token */
  readonly ucan: string;
}

export interface GrantCaveat {
  readonly type:
    | 'time-window'
    | 'block-scope'
    | 'read-only-sections'
    | 'max-uses';
  readonly value: string;
}

export interface SharingConfig {
  /** Function to create UCAN tokens */
  readonly createUcan: (params: {
    issuer: string;
    audience: string;
    resource: string;
    capability: string;
    expiration?: number;
  }) => Promise<string>;
  /** Function to verify UCAN tokens */
  readonly verifyUcan: (token: string) => Promise<{
    valid: boolean;
    issuer: string;
    audience: string;
    resource: string;
    capability: string;
  }>;
  /** Current user's DID */
  readonly currentDid: string;
}

// ── Capability Sharing Engine ───────────────────────────────────────

export class CapabilitySharing {
  private config: SharingConfig;
  private groups: Map<string, Group> = new Map();
  private links: Map<string, ShareLink> = new Map();
  private grants: Map<string, CapabilityGrant[]> = new Map(); // resource → grants
  private listeners: Set<(event: SharingEvent) => void> = new Set();

  constructor(config: SharingConfig) {
    this.config = config;
  }

  // ── Share Links ─────────────────────────────────────────────

  /**
   * Create a share link for a document or block.
   */
  async createShareLink(params: {
    documentId: string;
    blockId?: string;
    capability: Capability;
    audience: ShareAudience;
    expiresAt?: string;
    maxUses?: number;
  }): Promise<ShareLink> {
    const resource = this.buildResourceUri(
      params.documentId,
      params.blockId,
      params.capability,
      params.audience
    );

    const audienceStr =
      params.audience.type === 'anyone'
        ? '*'
        : params.audience.type === 'did'
        ? params.audience.did
        : params.audience.type === 'group'
        ? `group:${params.audience.groupId}`
        : params.audience.type === 'email'
        ? `email:${params.audience.email}`
        : `domain:${params.audience.domain}`;

    const ucan = await this.config.createUcan({
      issuer: this.config.currentDid,
      audience: audienceStr,
      resource,
      capability: params.capability,
      expiration: params.expiresAt
        ? Math.floor(new Date(params.expiresAt).getTime() / 1000)
        : undefined,
    });

    const link: ShareLink = {
      uri: resource,
      documentId: params.documentId,
      blockId: params.blockId ?? null,
      capability: params.capability,
      audience: params.audience,
      expiresAt: params.expiresAt ?? null,
      ucan,
      active: true,
      uses: 0,
      maxUses: params.maxUses ?? null,
      createdAt: new Date().toISOString(),
      creatorDid: this.config.currentDid,
    };

    this.links.set(link.uri, link);
    this.emit({ type: 'link-created', link });

    return link;
  }

  /**
   * Revoke a share link.
   */
  revokeShareLink(uri: string): boolean {
    const link = this.links.get(uri);
    if (!link) return false;
    link.active = false;
    this.emit({ type: 'link-revoked', link });
    return true;
  }

  /**
   * Claim a share link (when someone uses it).
   */
  async claimShareLink(
    uri: string,
    claimerDid: string
  ): Promise<CapabilityGrant | null> {
    const link = this.links.get(uri);
    if (!link || !link.active) return null;

    // Check expiration
    if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
      link.active = false;
      return null;
    }

    // Check max uses
    if (link.maxUses !== null && link.uses >= link.maxUses) {
      link.active = false;
      return null;
    }

    // Verify audience
    if (!this.audienceMatches(link.audience, claimerDid)) {
      return null;
    }

    // Create a delegated UCAN for the claimer
    const grantUcan = await this.config.createUcan({
      issuer: this.config.currentDid,
      audience: claimerDid,
      resource: link.uri,
      capability: link.capability,
    });

    const grant: CapabilityGrant = {
      issuer: this.config.currentDid,
      audience: claimerDid,
      resource: link.uri,
      capability: link.capability,
      caveats: [],
      expiresAt: link.expiresAt,
      ucan: grantUcan,
    };

    // Store grant
    const existing = this.grants.get(link.documentId) ?? [];
    existing.push(grant);
    this.grants.set(link.documentId, existing);

    link.uses++;
    this.emit({ type: 'link-claimed', link, grant });

    return grant;
  }

  // ── Groups ────────────────────────────────────────────────────

  /**
   * Create a group. Groups are UCAN delegation intermediaries.
   */
  async createGroup(params: {
    name: string;
    description?: string;
    defaultCapability?: Capability;
  }): Promise<Group> {
    const group: Group = {
      id: `group:${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: params.name,
      description: params.description ?? '',
      members: [],
      createdBy: this.config.currentDid,
      createdAt: new Date().toISOString(),
      defaultCapability: params.defaultCapability ?? 'read',
    };

    this.groups.set(group.id, group);
    this.emit({ type: 'group-created', group });

    return group;
  }

  /**
   * Add a member to a group.
   */
  async addGroupMember(
    groupId: string,
    memberDid: string,
    memberName: string,
    capability?: Capability
  ): Promise<GroupMember | null> {
    const group = this.groups.get(groupId);
    if (!group) return null;

    const memberCap = capability ?? group.defaultCapability;

    // Create a delegation UCAN: group → member
    const delegationUcan = await this.config.createUcan({
      issuer: groupId,
      audience: memberDid,
      resource: `group:${groupId}`,
      capability: memberCap,
    });

    const member: GroupMember = {
      did: memberDid,
      name: memberName,
      capability: memberCap,
      joinedAt: new Date().toISOString(),
      delegationUcan,
    };

    (group.members as GroupMember[]).push(member);
    this.emit({ type: 'member-added', group, member });

    return member;
  }

  /**
   * Remove a member from a group.
   */
  removeGroupMember(groupId: string, memberDid: string): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;

    const index = group.members.findIndex((m) => m.did === memberDid);
    if (index === -1) return false;

    const member = group.members[index];
    (group.members as GroupMember[]).splice(index, 1);
    this.emit({ type: 'member-removed', group, member });

    return true;
  }

  // ── Capability Checking ───────────────────────────────────────

  /**
   * Check if a DID has a specific capability on a resource.
   */
  hasCapability(
    did: string,
    documentId: string,
    requiredCapability: Capability,
    blockId?: string
  ): boolean {
    // Owner always has all capabilities
    // (In production, check the document's owner DID)

    // Check direct grants
    const docGrants = this.grants.get(documentId) ?? [];
    for (const grant of docGrants) {
      if (
        grant.audience === did &&
        this.capabilityIncludes(grant.capability, requiredCapability)
      ) {
        // Check expiration
        if (grant.expiresAt && new Date(grant.expiresAt) < new Date()) continue;
        return true;
      }
    }

    // Check group memberships
    for (const group of this.groups.values()) {
      const member = group.members.find((m) => m.did === did);
      if (!member) continue;

      // Check if the group has a grant on this document
      for (const grant of docGrants) {
        if (
          grant.audience === group.id &&
          this.capabilityIncludes(grant.capability, requiredCapability)
        ) {
          // Member capability must also cover the required capability
          if (this.capabilityIncludes(member.capability, requiredCapability)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Get the effective capability for a DID on a document.
   */
  getEffectiveCapability(did: string, documentId: string): Capability | null {
    let maxLevel = -1;

    const docGrants = this.grants.get(documentId) ?? [];
    for (const grant of docGrants) {
      if (grant.audience === did) {
        if (grant.expiresAt && new Date(grant.expiresAt) < new Date()) continue;
        const level = CAPABILITY_HIERARCHY.indexOf(grant.capability);
        if (level > maxLevel) maxLevel = level;
      }
    }

    // Check group memberships
    for (const group of this.groups.values()) {
      const member = group.members.find((m) => m.did === did);
      if (!member) continue;

      for (const grant of docGrants) {
        if (grant.audience === group.id) {
          const grantLevel = CAPABILITY_HIERARCHY.indexOf(grant.capability);
          const memberLevel = CAPABILITY_HIERARCHY.indexOf(member.capability);
          const effectiveLevel = Math.min(grantLevel, memberLevel);
          if (effectiveLevel > maxLevel) maxLevel = effectiveLevel;
        }
      }
    }

    return maxLevel >= 0 ? CAPABILITY_HIERARCHY[maxLevel] : null;
  }

  /**
   * Get all active share links for a document.
   */
  getShareLinks(documentId: string): ShareLink[] {
    return Array.from(this.links.values()).filter(
      (l) => l.documentId === documentId && l.active
    );
  }

  /**
   * Get all groups.
   */
  getGroups(): Group[] {
    return Array.from(this.groups.values());
  }

  /**
   * Listen for sharing events.
   */
  onEvent(listener: (event: SharingEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── Private ───────────────────────────────────────────────────

  private buildResourceUri(
    documentId: string,
    blockId: string | undefined,
    capability: Capability,
    audience: ShareAudience
  ): string {
    let uri = `aeon://doc/${documentId}`;
    if (blockId) uri += `/block/${blockId}`;
    uri += `?cap=${capability}`;

    if (audience.type === 'group') {
      uri += `&group=${audience.groupId}`;
    } else if (audience.type === 'domain') {
      uri += `&domain=${audience.domain}`;
    }

    return uri;
  }

  private audienceMatches(
    audience: ShareAudience,
    claimerDid: string
  ): boolean {
    switch (audience.type) {
      case 'anyone':
        return true;
      case 'did':
        return audience.did === claimerDid;
      case 'group': {
        const group = this.groups.get(audience.groupId);
        return group?.members.some((m) => m.did === claimerDid) ?? false;
      }
      case 'email':
        return true; // email verification happens externally
      case 'domain':
        return true; // domain verification happens externally
    }
  }

  private capabilityIncludes(
    granted: Capability,
    required: Capability
  ): boolean {
    const grantedLevel = CAPABILITY_HIERARCHY.indexOf(granted);
    const requiredLevel = CAPABILITY_HIERARCHY.indexOf(required);
    return grantedLevel >= requiredLevel;
  }

  private emit(event: SharingEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

// ── Events ──────────────────────────────────────────────────────────

export type SharingEvent =
  | { type: 'link-created'; link: ShareLink }
  | { type: 'link-revoked'; link: ShareLink }
  | { type: 'link-claimed'; link: ShareLink; grant: CapabilityGrant }
  | { type: 'group-created'; group: Group }
  | { type: 'member-added'; group: Group; member: GroupMember }
  | { type: 'member-removed'; group: Group; member: GroupMember };
