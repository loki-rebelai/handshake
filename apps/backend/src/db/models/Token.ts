import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { v4 } from 'uuid';

@Entity()
export class Token {
  @PrimaryKey()
  id: string = v4();

  @Property({ unique: true })
  mint!: string;

  @Property()
  name!: string;

  @Property()
  symbol!: string;

  @Property()
  decimals!: number;

  constructor(mint: string, name: string, symbol: string, decimals: number) {
    this.mint = mint;
    this.name = name;
    this.symbol = symbol;
    this.decimals = decimals;
  }

  @Property()
  createdAt: Date = new Date();
}
