import { Migration } from '@mikro-orm/migrations';

export class Migration20260214120000 extends Migration {

  override async up(): Promise<void> {
    // SilkAccount table
    this.addSql(`create table "silk_account" (
      "id" varchar(255) not null,
      "pda" varchar(255) not null,
      "owner" varchar(255) not null,
      "mint" varchar(255) not null,
      "status" varchar(255) not null default 'ACTIVE',
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      constraint "silk_account_pkey" primary key ("id"),
      constraint "silk_account_status_check" check ("status" in ('ACTIVE', 'CLOSED'))
    );`);
    this.addSql(`alter table "silk_account" add constraint "silk_account_pda_unique" unique ("pda");`);

    // SilkAccountOperator table
    this.addSql(`create table "silk_account_operator" (
      "id" varchar(255) not null,
      "account_id" varchar(255) not null,
      "operator" varchar(255) not null,
      "per_tx_limit" text not null,
      "created_at" timestamptz not null default now(),
      constraint "silk_account_operator_pkey" primary key ("id")
    );`);
    this.addSql(`alter table "silk_account_operator" add constraint "silk_account_operator_account_id_operator_unique" unique ("account_id", "operator");`);
    this.addSql(`alter table "silk_account_operator" add constraint "silk_account_operator_account_id_foreign" foreign key ("account_id") references "silk_account" ("id") on update cascade;`);

    // SilkAccountEvent table
    this.addSql(`create table "silk_account_event" (
      "id" varchar(255) not null,
      "account_id" varchar(255) not null,
      "event_type" varchar(255) not null,
      "txid" varchar(255) not null,
      "actor" varchar(255) not null,
      "data" jsonb null,
      "created_at" timestamptz not null default now(),
      constraint "silk_account_event_pkey" primary key ("id"),
      constraint "silk_account_event_event_type_check" check ("event_type" in ('ACCOUNT_CREATED', 'ACCOUNT_CLOSED', 'DEPOSIT', 'TRANSFER', 'OPERATOR_ADDED', 'OPERATOR_REMOVED', 'PAUSED', 'UNPAUSED'))
    );`);
    this.addSql(`alter table "silk_account_event" add constraint "silk_account_event_account_id_foreign" foreign key ("account_id") references "silk_account" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "silk_account_event" cascade;`);
    this.addSql(`drop table if exists "silk_account_operator" cascade;`);
    this.addSql(`drop table if exists "silk_account" cascade;`);
  }

}
