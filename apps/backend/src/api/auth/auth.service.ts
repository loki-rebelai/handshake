import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { createHash, randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import nacl from 'tweetnacl';
import { PublicKey } from '@solana/web3.js';
import { ApiKey } from '../../db/models/ApiKey';

interface ChallengeEntry {
  nonce: string;
  expiresAt: number;
}

@Injectable()
export class AuthService {
  private readonly challenges = new Map<string, ChallengeEntry>();

  constructor(private readonly em: EntityManager) {}

  generateChallenge(pubkey: string): string {
    const nonce = `silk_${uuidv4()}`;
    this.challenges.set(pubkey, { nonce, expiresAt: Date.now() + 60_000 });
    return nonce;
  }

  async verifyAndIssueKey(pubkey: string, signature: string): Promise<string> {
    const entry = this.challenges.get(pubkey);
    if (!entry || Date.now() > entry.expiresAt) {
      throw new Error('No valid challenge found — call /api/auth/challenge first');
    }
    this.challenges.delete(pubkey);

    const messageBytes = Buffer.from(entry.nonce, 'utf-8');
    const signatureBytes = Buffer.from(signature, 'base64');
    const pubkeyBytes = new PublicKey(pubkey).toBytes();

    const valid = nacl.sign.detached.verify(messageBytes, signatureBytes, pubkeyBytes);
    if (!valid) {
      throw new Error('Signature verification failed');
    }

    const rawKey = `sw_${randomBytes(32).toString('hex')}`;
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    let record = await this.em.findOne(ApiKey, { pubkey });
    if (record) {
      record.keyHash = keyHash;
      record.createdAt = new Date();
      record.revokedAt = undefined;
    } else {
      record = new ApiKey(pubkey, keyHash);
      this.em.persist(record);
    }
    await this.em.flush();

    return rawKey;
  }

  async validateKey(rawKey: string): Promise<{ pubkey: string } | null> {
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const record = await this.em.findOne(ApiKey, { keyHash });
    if (!record || record.revokedAt) return null;
    return { pubkey: record.pubkey };
  }

  async revokeKey(rawKey: string): Promise<void> {
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const record = await this.em.findOne(ApiKey, { keyHash });
    if (!record) throw new Error('Key not found');
    record.revokedAt = new Date();
    await this.em.flush();
  }
}
