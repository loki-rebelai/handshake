import { Migration } from '@mikro-orm/migrations';

export class Migration20260215120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
      UPDATE "transfer" t
      SET "amount" = (CAST(t."amount_raw" AS numeric) / POW(10, tk."decimals"))::text
      FROM "pool" p
      JOIN "token" tk ON p."token_id" = tk."id"
      WHERE t."pool_id" = p."id"
        AND t."amount" = t."amount_raw";
    `);
  }

  override async down(): Promise<void> {
    // Cannot reliably reverse — would need to store original bad values
  }

}
