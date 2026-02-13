import { Migration } from '@mikro-orm/migrations';

export class Migration20260212120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "transfer" alter column "create_txid" drop not null;`);

    this.addSql(`alter table "transfer" drop constraint if exists "transfer_status_check";`);
    this.addSql(`alter table "transfer" add constraint "transfer_status_check" check ("status" in ('PENDING', 'ACTIVE', 'CLAIMED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'DECLINED'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`update "transfer" set "create_txid" = 'unknown' where "create_txid" is null;`);
    this.addSql(`alter table "transfer" alter column "create_txid" set not null;`);

    this.addSql(`alter table "transfer" drop constraint if exists "transfer_status_check";`);
    this.addSql(`alter table "transfer" add constraint "transfer_status_check" check ("status" in ('ACTIVE', 'CLAIMED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'DECLINED'));`);
  }

}
