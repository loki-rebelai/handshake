import { Entity, PrimaryKey, Property, Enum, Collection, OneToMany } from '@mikro-orm/core';
import { v4 } from 'uuid';
import { SilkAccountOperator } from './SilkAccountOperator';

export enum SilkAccountStatus {
  ACTIVE = 'ACTIVE',
  CLOSED = 'CLOSED',
}

@Entity()
export class SilkAccount {
  @PrimaryKey()
  id: string = v4();

  @Property({ unique: true })
  pda!: string;

  @Property()
  owner!: string;

  @Property()
  mint!: string;

  @Enum(() => SilkAccountStatus)
  status: SilkAccountStatus = SilkAccountStatus.ACTIVE;

  @OneToMany(() => SilkAccountOperator, (op) => op.account)
  operators = new Collection<SilkAccountOperator>(this);

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();

  constructor(pda: string, owner: string, mint: string) {
    this.pda = pda;
    this.owner = owner;
    this.mint = mint;
  }
}
