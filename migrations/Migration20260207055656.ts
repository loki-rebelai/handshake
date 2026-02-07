import { Migration } from '@mikro-orm/migrations';

export class Migration20260207055656 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "token" ("id" varchar(255) not null, "mint" varchar(255) not null, "name" varchar(255) not null, "symbol" varchar(255) not null, "decimals" int not null, "created_at" timestamptz not null, constraint "token_pkey" primary key ("id"));`);
    this.addSql(`alter table "token" add constraint "token_mint_unique" unique ("mint");`);

    this.addSql(`create table "pool" ("id" varchar(255) not null, "pool_id" varchar(255) not null, "pool_pda" varchar(255) not null, "operator_key" varchar(255) not null, "token_id" varchar(255) not null, "fee_bps" int not null, "total_transfers_created" text not null default '0', "total_transfers_resolved" text not null default '0', "is_paused" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "pool_pkey" primary key ("id"));`);
    this.addSql(`alter table "pool" add constraint "pool_pool_pda_unique" unique ("pool_pda");`);

    this.addSql(`create table "transfer" ("id" varchar(255) not null, "transfer_pda" varchar(255) not null, "sender" varchar(255) not null, "recipient" varchar(255) not null, "amount" text not null, "amount_raw" text not null, "token_id" varchar(255) not null, "pool_id" varchar(255) not null, "status" text check ("status" in ('ACTIVE', 'CLAIMED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'DECLINED')) not null default 'ACTIVE', "memo" varchar(255) null, "create_txid" varchar(255) not null, "claim_txid" varchar(255) null, "cancel_txid" varchar(255) null, "claimable_after" timestamptz null, "claimable_until" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "transfer_pkey" primary key ("id"));`);
    this.addSql(`alter table "transfer" add constraint "transfer_transfer_pda_unique" unique ("transfer_pda");`);

    this.addSql(`alter table "pool" add constraint "pool_token_id_foreign" foreign key ("token_id") references "token" ("id") on update cascade;`);

    this.addSql(`alter table "transfer" add constraint "transfer_token_id_foreign" foreign key ("token_id") references "token" ("id") on update cascade;`);
    this.addSql(`alter table "transfer" add constraint "transfer_pool_id_foreign" foreign key ("pool_id") references "pool" ("id") on update cascade;`);
  }

}
