import { Entity, PrimaryKey, Property, ManyToOne } from '@mikro-orm/core';
import { v4 } from 'uuid';
import { Token } from './Token';

@Entity()
export class Pool {
  @PrimaryKey()
  id: string = v4();

  @Property()
  poolId!: string;

  @Property({ unique: true })
  poolPda!: string;

  @Property()
  operatorKey!: string;

  @ManyToOne(() => Token)
  token!: Token;

  @Property()
  feeBps!: number;

  constructor(
    poolId: string,
    poolPda: string,
    operatorKey: string,
    token: Token,
    feeBps: number,
    opts?: { isPaused?: boolean },
  ) {
    this.poolId = poolId;
    this.poolPda = poolPda;
    this.operatorKey = operatorKey;
    this.token = token;
    this.feeBps = feeBps;
    if (opts?.isPaused) this.isPaused = opts.isPaused;
  }

  @Property({ type: 'text', default: '0' })
  totalTransfersCreated: string = '0';

  @Property({ type: 'text', default: '0' })
  totalTransfersResolved: string = '0';

  @Property({ default: false })
  isPaused: boolean = false;

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
