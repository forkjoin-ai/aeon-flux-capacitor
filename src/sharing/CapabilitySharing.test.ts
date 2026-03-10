import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CapabilitySharing } from './CapabilitySharing';

// ── Helpers ─────────────────────────────────────────────────────────

const mockCreateUcan = vi.fn().mockResolvedValue('eyJ.mock.ucan');
const mockVerifyUcan = vi.fn().mockResolvedValue({
  valid: true,
  issuer: 'did:test:issuer',
  audience: 'did:test:audience',
  resource: 'doc:test-doc',
  capability: 'edit',
});

function makeSharing() {
  return new CapabilitySharing({
    createUcan: mockCreateUcan,
    verifyUcan: mockVerifyUcan,
    currentDid: 'did:test:owner',
  });
}

// ── Tests ───────────────────────────────────────────────────────────

describe('CapabilitySharing', () => {
  let sharing: CapabilitySharing;

  beforeEach(() => {
    mockCreateUcan.mockClear();
    mockVerifyUcan.mockClear();
    sharing = makeSharing();
  });

  describe('construction', () => {
    it('creates with required config', () => {
      expect(sharing).toBeDefined();
    });
  });

  describe('share links', () => {
    it('creates a share link for a document', async () => {
      const link = await sharing.createShareLink({
        documentId: 'doc-1',
        capability: 'read',
        audience: { type: 'anyone' },
      });
      expect(link).toBeDefined();
      expect(link.documentId).toBe('doc-1');
      expect(link.capability).toBe('read');
      expect(link.uri).toBeTruthy();
      expect(link.ucan).toBeTruthy();
    });

    it('creates a share link for a specific block', async () => {
      const link = await sharing.createShareLink({
        documentId: 'doc-1',
        blockId: 'block-5',
        capability: 'comment',
        audience: { type: 'anyone' },
      });
      expect(link.blockId).toBe('block-5');
    });

    it('creates link with DID audience', async () => {
      const link = await sharing.createShareLink({
        documentId: 'doc-1',
        capability: 'edit',
        audience: { type: 'did', did: 'did:test:collaborator' },
      });
      expect(link.audience.type).toBe('did');
    });

    it('creates link with group audience', async () => {
      const group = await sharing.createGroup({ name: 'Editors' });
      const link = await sharing.createShareLink({
        documentId: 'doc-1',
        capability: 'edit',
        audience: { type: 'group', groupId: group.id },
      });
      expect(link.audience.type).toBe('group');
    });

    it('creates link with expiration', async () => {
      const link = await sharing.createShareLink({
        documentId: 'doc-1',
        capability: 'read',
        audience: { type: 'anyone' },
        expiresAt: '2099-12-31T23:59:59Z',
      });
      expect(link.expiresAt).toBe('2099-12-31T23:59:59Z');
    });

    it('creates link with max uses', async () => {
      const link = await sharing.createShareLink({
        documentId: 'doc-1',
        capability: 'read',
        audience: { type: 'anyone' },
        maxUses: 10,
      });
      expect(link.maxUses).toBe(10);
    });

    it('revokes a share link', async () => {
      const link = await sharing.createShareLink({
        documentId: 'doc-1',
        capability: 'read',
        audience: { type: 'anyone' },
      });
      const revoked = sharing.revokeShareLink(link.uri);
      expect(revoked).toBe(true);
    });

    it('returns false revoking nonexistent link', () => {
      expect(sharing.revokeShareLink('fake-uri')).toBe(false);
    });
  });

  describe('claiming links', () => {
    it('claims a share link', async () => {
      const link = await sharing.createShareLink({
        documentId: 'doc-1',
        capability: 'read',
        audience: { type: 'anyone' },
      });

      const grant = await sharing.claimShareLink(link.uri, 'did:test:claimer');
      expect(grant).not.toBeNull();
      expect(grant!.capability).toBe('read');
    });

    it('returns null for revoked link', async () => {
      const link = await sharing.createShareLink({
        documentId: 'doc-1',
        capability: 'read',
        audience: { type: 'anyone' },
      });
      sharing.revokeShareLink(link.uri);

      const grant = await sharing.claimShareLink(link.uri, 'did:test:claimer');
      expect(grant).toBeNull();
    });

    it('returns null for nonexistent link', async () => {
      const grant = await sharing.claimShareLink(
        'fake-uri',
        'did:test:claimer'
      );
      expect(grant).toBeNull();
    });

    it('enforces DID-specific links', async () => {
      const link = await sharing.createShareLink({
        documentId: 'doc-1',
        capability: 'read',
        audience: { type: 'did', did: 'did:test:specific-user' },
      });

      const wrongUser = await sharing.claimShareLink(
        link.uri,
        'did:test:wrong-user'
      );
      expect(wrongUser).toBeNull();

      const rightUser = await sharing.claimShareLink(
        link.uri,
        'did:test:specific-user'
      );
      expect(rightUser).not.toBeNull();
    });
  });

  describe('groups', () => {
    it('creates a group', async () => {
      const group = await sharing.createGroup({
        name: 'Test Group',
        description: 'A test',
      });
      expect(group).toBeDefined();
      expect(group.name).toBe('Test Group');
      expect(group.id).toBeTruthy();
    });

    it('adds a member to a group', async () => {
      const group = await sharing.createGroup({ name: 'Team' });
      const member = await sharing.addGroupMember(
        group.id,
        'did:test:member1',
        'Alice'
      );
      expect(member).not.toBeNull();
      expect(member!.did).toBe('did:test:member1');
    });

    it('adds member with custom capability', async () => {
      const group = await sharing.createGroup({ name: 'Team' });
      const member = await sharing.addGroupMember(
        group.id,
        'did:test:m1',
        'Bob',
        'admin'
      );
      expect(member).not.toBeNull();
      expect(member!.capability).toBe('admin');
    });

    it('returns null adding member to nonexistent group', async () => {
      const member = await sharing.addGroupMember(
        'fake-group',
        'did:test:m',
        'Nobody'
      );
      expect(member).toBeNull();
    });

    it('removes a member from a group', async () => {
      const group = await sharing.createGroup({ name: 'Team' });
      await sharing.addGroupMember(group.id, 'did:test:m1', 'Alice');
      const removed = sharing.removeGroupMember(group.id, 'did:test:m1');
      expect(removed).toBe(true);
    });

    it('returns false removing nonexistent member', async () => {
      const group = await sharing.createGroup({ name: 'Team' });
      expect(sharing.removeGroupMember(group.id, 'did:test:ghost')).toBe(false);
    });
  });

  describe('capability checking', () => {
    it('checks capability via grant', async () => {
      const link = await sharing.createShareLink({
        documentId: 'doc-1',
        capability: 'edit',
        audience: { type: 'anyone' },
      });
      await sharing.claimShareLink(link.uri, 'did:test:user1');

      const has = sharing.hasCapability('did:test:user1', 'doc-1', 'read');
      expect(has).toBe(true); // edit includes read
    });

    it('respects capability hierarchy', async () => {
      const link = await sharing.createShareLink({
        documentId: 'doc-1',
        capability: 'read',
        audience: { type: 'anyone' },
      });
      await sharing.claimShareLink(link.uri, 'did:test:user1');

      expect(sharing.hasCapability('did:test:user1', 'doc-1', 'read')).toBe(
        true
      );
      expect(sharing.hasCapability('did:test:user1', 'doc-1', 'edit')).toBe(
        false
      );
    });

    it('returns false for no grants', () => {
      expect(sharing.hasCapability('did:test:nobody', 'doc-1', 'read')).toBe(
        false
      );
    });
  });

  describe('effective capability', () => {
    it('returns highest capability for a DID', async () => {
      const link1 = await sharing.createShareLink({
        documentId: 'doc-1',
        capability: 'read',
        audience: { type: 'anyone' },
      });
      const link2 = await sharing.createShareLink({
        documentId: 'doc-1',
        capability: 'edit',
        audience: { type: 'anyone' },
      });
      await sharing.claimShareLink(link1.uri, 'did:test:user1');
      await sharing.claimShareLink(link2.uri, 'did:test:user1');

      const effective = sharing.getEffectiveCapability(
        'did:test:user1',
        'doc-1'
      );
      expect(effective).toBe('edit');
    });

    it('returns null for no access', () => {
      expect(
        sharing.getEffectiveCapability('did:test:nobody', 'doc-1')
      ).toBeNull();
    });
  });

  describe('events', () => {
    it('emits events on share link creation', async () => {
      let emitted = false;
      sharing.onEvent(() => {
        emitted = true;
      });
      await sharing.createShareLink({
        documentId: 'doc-1',
        capability: 'read',
        audience: { type: 'anyone' },
      });
      expect(emitted).toBe(true);
    });
  });
});
