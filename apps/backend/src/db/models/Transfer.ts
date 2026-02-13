import { Entity, PrimaryKey, Property, ManyToOne, Enum } from '@mikro-orm/core';
import { v4 } from 'uuid';
import { Token } from './Token';
import { Pool } from './Pool';

export enum TransferStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  CLAIMED = 'CLAIMED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  DECLINED = 'DECLINED',
}

@Entity()
export class Transfer {
  @PrimaryKey()
  id: string = v4();

  @Property({ unique: true })
  transferPda!: string;

  @Property()
  sender!: string;

  @Property()
  recipient!: string;

  @Property({ type: 'text' })
  amount!: string;

  @Property({ type: 'text' })
  amountRaw!: string;

  @ManyToOne(() => Token)
  token!: Token;

  @ManyToOne(() => Pool)
  pool!: Pool;

  @Enum(() => TransferStatus)
  status: TransferStatus = TransferStatus.ACTIVE;

  constructor(
    transferPda: string,
    sender: string,
    recipient: string,
    amount: string,
    amountRaw: string,
    token: Token,
    pool: Pool,
    opts?: {
      status?: TransferStatus;
      memo?: string;
      createTxid?: string;
      claimableAfter?: Date;
      claimableUntil?: Date;
    },
  ) {
    this.transferPda = transferPda;
    this.sender = sender;
    this.recipient = recipient;
    this.amount = amount;
    this.amountRaw = amountRaw;
    this.token = token;
    this.pool = pool;
    if (opts?.status) this.status = opts.status;
    if (opts?.memo) this.memo = opts.memo;
    if (opts?.createTxid) this.createTxid = opts.createTxid;
    if (opts?.claimableAfter) this.claimableAfter = opts.claimableAfter;
    if (opts?.claimableUntil) this.claimableUntil = opts.claimableUntil;
  }

  @Property({ nullable: true })
  memo?: string;

  @Property({ nullable: true })
  createTxid?: string;

  @Property({ nullable: true })
  claimTxid?: string;

  @Property({ nullable: true })
  cancelTxid?: string;

  @Property({ nullable: true })
  claimableAfter?: Date;

  @Property({ nullable: true })
  claimableUntil?: Date;

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
