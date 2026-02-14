import { Entity, PrimaryKey, Property, ManyToOne, Unique } from '@mikro-orm/core';
import { v4 } from 'uuid';
import { SilkAccount } from './SilkAccount';

@Entity()
@Unique({ properties: ['account', 'operator'] })
export class SilkAccountOperator {
  @PrimaryKey()
  id: string = v4();

  @ManyToOne(() => SilkAccount)
  account!: SilkAccount;

  @Property()
  operator!: string;

  @Property({ type: 'text' })
  perTxLimit!: string;

  @Property()
  createdAt: Date = new Date();

  constructor(account: SilkAccount, operator: string, perTxLimit: string) {
    this.account = account;
    this.operator = operator;
    this.perTxLimit = perTxLimit;
  }
}
