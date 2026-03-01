import { AuthService } from './auth.service';

// Minimal mock for EntityManager
function makeMockEm(existing: any = null) {
  const record = existing ?? null;
  return {
    findOne: jest.fn().mockResolvedValue(record),
    persist: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
  };
}

describe('AuthService', () => {
  describe('generateChallenge', () => {
    it('returns a nonce starting with silk_', () => {
      const service = new AuthService(makeMockEm() as any);
      const nonce = service.generateChallenge('11111111111111111111111111111111');
      expect(nonce).toMatch(/^silk_/);
    });

    it('returns a different nonce each time', () => {
      const service = new AuthService(makeMockEm() as any);
      const pubkey = '11111111111111111111111111111111';
      const n1 = service.generateChallenge(pubkey);
      const n2 = service.generateChallenge(pubkey);
      expect(n1).not.toBe(n2);
    });
  });

  describe('validateKey', () => {
    it('returns null for unknown key', async () => {
      const service = new AuthService(makeMockEm(null) as any);
      const result = await service.validateKey('sw_unknownkey');
      expect(result).toBeNull();
    });

    it('returns pubkey for valid non-revoked key', async () => {
      const { createHash } = require('crypto');
      const rawKey = 'sw_testkey';
      const keyHash = createHash('sha256').update(rawKey).digest('hex');
      const em = makeMockEm({ pubkey: 'testpubkey', keyHash, revokedAt: undefined });
      const service = new AuthService(em as any);
      const result = await service.validateKey(rawKey);
      expect(result).toEqual({ pubkey: 'testpubkey' });
    });

    it('returns null for revoked key', async () => {
      const { createHash } = require('crypto');
      const rawKey = 'sw_revokedkey';
      const keyHash = createHash('sha256').update(rawKey).digest('hex');
      const em = makeMockEm({ pubkey: 'testpubkey', keyHash, revokedAt: new Date() });
      const service = new AuthService(em as any);
      const result = await service.validateKey(rawKey);
      expect(result).toBeNull();
    });
  });

  describe('revokeKey', () => {
    it('throws if key not found', async () => {
      const service = new AuthService(makeMockEm(null) as any);
      await expect(service.revokeKey('sw_unknown')).rejects.toThrow('Key not found');
    });

    it('sets revokedAt on the record', async () => {
      const { createHash } = require('crypto');
      const rawKey = 'sw_activekey';
      const keyHash = createHash('sha256').update(rawKey).digest('hex');
      const record = { pubkey: 'testpubkey', keyHash, revokedAt: undefined };
      const em = makeMockEm(record);
      const service = new AuthService(em as any);
      await service.revokeKey(rawKey);
      expect(record.revokedAt).toBeInstanceOf(Date);
      expect(em.flush).toHaveBeenCalled();
    });
  });
});
