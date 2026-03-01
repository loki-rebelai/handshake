import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { v4 } from 'uuid';

@Entity()
export class ApiKey {
  @PrimaryKey()
  id: string = v4();

  @Property({ unique: true })
  pubkey!: string;

  @Property({ unique: true })
  keyHash!: string;

  @Property()
  createdAt: Date = new Date();

  @Property({ nullable: true })
  revokedAt?: Date;

  constructor(pubkey: string, keyHash: string) {
    this.pubkey = pubkey;
    this.keyHash = keyHash;
  }
}
