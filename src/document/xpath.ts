/**
 * XPath Addressing — Node-level permission binding
 *
 * XPath addresses map to UCAN delegation chains, enabling
 * per-block access control: share a paragraph, lock a section,
 * grant edit access to a heading without exposing the whole document.
 */

import type * as Y from 'yjs';

// ── Types ───────────────────────────────────────────────────────────

/** XPath permission level */
export type PermissionLevel = 'read' | 'write' | 'admin' | 'none';

/** An XPath address for a node in the document tree */
export interface XPathAddress {
  /** Full XPath expression */
  readonly path: string;
  /** Block type at this path */
  readonly blockType: string;
  /** Block ID attribute */
  readonly blockId: string;
  /** Depth in the tree (0 = root) */
  readonly depth: number;
  /** Position among siblings of the same type */
  readonly siblingIndex: number;
}

/** XPath permission binding — maps an XPath to a permission */
export interface XPathPermission {
  /** XPath expression (may contain wildcards) */
  readonly xpath: string;
  /** DID of the subject (who this permission is for) */
  readonly subjectDid: string;
  /** Permission level */
  readonly permission: PermissionLevel;
  /** UCAN token authorizing this permission */
  readonly ucanToken: string;
  /** Expiry timestamp (ISO-8601) */
  readonly expiresAt?: string;
}

/** Result of a permission check */
export interface PermissionCheckResult {
  readonly allowed: boolean;
  readonly permission: PermissionLevel;
  readonly matchedRule?: XPathPermission;
  readonly reason?: string;
}

// ── XPath Engine ────────────────────────────────────────────────────

export class XPathEngine {
  /** Permission bindings */
  private permissions: XPathPermission[] = [];

  /** Default permission for unmatched nodes */
  private defaultPermission: PermissionLevel = 'none';

  /**
   * Compute the XPath address for a block in the document.
   */
  computeAddress(
    fragment: Y.XmlFragment,
    blockId: string
  ): XPathAddress | null {
    for (let i = 0; i < fragment.length; i++) {
      const item = fragment.get(i);
      if (item instanceof Object && 'getAttribute' in item) {
        const element = item as Y.XmlElement;
        if (element.getAttribute('id') === blockId) {
          const blockType = element.nodeName;

          // Count preceding siblings of same type
          let siblingIndex = 0;
          for (let j = 0; j < i; j++) {
            const sibling = fragment.get(j);
            if (
              sibling instanceof Object &&
              'nodeName' in sibling &&
              (sibling as Y.XmlElement).nodeName === blockType
            ) {
              siblingIndex++;
            }
          }

          return {
            path: `/document/${blockType}[${siblingIndex}]`,
            blockType,
            blockId,
            depth: 1,
            siblingIndex,
          };
        }
      }
    }
    return null;
  }

  /**
   * Compute XPath addresses for all blocks in the document.
   */
  computeAllAddresses(fragment: Y.XmlFragment): XPathAddress[] {
    const addresses: XPathAddress[] = [];
    const typeCounts = new Map<string, number>();

    for (let i = 0; i < fragment.length; i++) {
      const item = fragment.get(i);
      if (item instanceof Object && 'getAttribute' in item) {
        const element = item as Y.XmlElement;
        const blockType = element.nodeName;
        const blockId = element.getAttribute('id');

        const count = typeCounts.get(blockType) || 0;
        typeCounts.set(blockType, count + 1);

        if (blockId) {
          addresses.push({
            path: `/document/${blockType}[${count}]`,
            blockType,
            blockId,
            depth: 1,
            siblingIndex: count,
          });
        }
      }
    }

    return addresses;
  }

  // ── Permissions ───────────────────────────────────────────────

  /** Set the default permission for nodes without explicit bindings */
  setDefaultPermission(level: PermissionLevel): void {
    this.defaultPermission = level;
  }

  /** Add a permission binding */
  addPermission(permission: XPathPermission): void {
    this.permissions.push(permission);
  }

  /** Remove all permissions for a subject */
  removePermissionsFor(subjectDid: string): void {
    this.permissions = this.permissions.filter(
      (p) => p.subjectDid !== subjectDid
    );
  }

  /** Remove all permissions for an XPath */
  removePermissionsAt(xpath: string): void {
    this.permissions = this.permissions.filter((p) => p.xpath !== xpath);
  }

  /**
   * Check if a subject has the required permission at a given XPath.
   */
  checkPermission(
    xpath: string,
    subjectDid: string,
    required: PermissionLevel
  ): PermissionCheckResult {
    // Find the most specific matching rule
    const matchingRules = this.permissions.filter((p) => {
      if (p.subjectDid !== subjectDid && p.subjectDid !== '*') return false;
      if (p.expiresAt && new Date(p.expiresAt) < new Date()) return false;
      return this.xpathMatches(p.xpath, xpath);
    });

    if (matchingRules.length === 0) {
      return {
        allowed: this.isPermissionSufficient(this.defaultPermission, required),
        permission: this.defaultPermission,
        reason: 'No explicit permission binding; using default',
      };
    }

    // Use the most specific (longest matching) rule
    const bestRule = matchingRules.sort(
      (a, b) => b.xpath.length - a.xpath.length
    )[0];

    return {
      allowed: this.isPermissionSufficient(bestRule.permission, required),
      permission: bestRule.permission,
      matchedRule: bestRule,
    };
  }

  /**
   * Get all permissions for a subject across the document.
   */
  getPermissionsFor(subjectDid: string): XPathPermission[] {
    return this.permissions.filter(
      (p) => p.subjectDid === subjectDid || p.subjectDid === '*'
    );
  }

  /** Get all permission bindings */
  getAllPermissions(): XPathPermission[] {
    return [...this.permissions];
  }

  // ── Private ───────────────────────────────────────────────────

  /**
   * Check if an XPath pattern matches a target XPath.
   * Supports wildcards: * matches any single level.
   */
  private xpathMatches(pattern: string, target: string): boolean {
    if (pattern === target) return true;
    if (pattern === '/*' || pattern === '/document/*') return true;

    const patternParts = pattern.split('/').filter(Boolean);
    const targetParts = target.split('/').filter(Boolean);

    if (patternParts.length > targetParts.length) return false;

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i] === '*') continue;
      if (patternParts[i] !== targetParts[i]) return false;
    }

    return true;
  }

  /** Check if a held permission level is sufficient for a required level */
  private isPermissionSufficient(
    held: PermissionLevel,
    required: PermissionLevel
  ): boolean {
    const hierarchy: Record<PermissionLevel, number> = {
      none: 0,
      read: 1,
      write: 2,
      admin: 3,
    };
    return hierarchy[held] >= hierarchy[required];
  }
}
