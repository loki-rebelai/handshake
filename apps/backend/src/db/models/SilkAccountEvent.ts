import { Entity, PrimaryKey, Property, ManyToOne, Enum } from '@mikro-orm/core';
import { v4 } from 'uuid';
import { SilkAccount } from './SilkAccount';

export enum SilkAccountEventType {
  ACCOUNT_CREATED = 'ACCOUNT_CREATED',
  ACCOUNT_CLOSED = 'ACCOUNT_CLOSED',
  DEPOSIT = 'DEPOSIT',
  TRANSFER = 'TRANSFER',
  OPERATOR_ADDED = 'OPERATOR_ADDED',
  OPERATOR_REMOVED = 'OPERATOR_REMOVED',
  PAUSED = 'PAUSED',
  UNPAUSED = 'UNPAUSED',
}

@Entity()
export class SilkAccountEvent {
  @PrimaryKey()
  id: string = v4();

  @ManyToOne(() => SilkAccount)
  account!: SilkAccount;

  @Enum(() => SilkAccountEventType)
  eventType!: SilkAccountEventType;

  @Property()
  txid!: string;

  @Property()
  actor!: string;

  @Property({ type: 'json', nullable: true })
  data?: Record<string, any>;

  @Property()
  createdAt: Date = new Date();

  constructor(
    account: SilkAccount,
    eventType: SilkAccountEventType,
    txid: string,
    actor: string,
    data?: Record<string, any>,
  ) {
    this.account = account;
    this.eventType = eventType;
    this.txid = txid;
    this.actor = actor;
    this.data = data;
  }
}
