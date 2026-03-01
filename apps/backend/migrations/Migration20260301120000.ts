import { Migration } from '@mikro-orm/migrations';

export class Migration20260301120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE "api_key" (
        "id" varchar(255) NOT NULL,
        "pubkey" varchar(255) NOT NULL,
        "key_hash" varchar(255) NOT NULL,
        "created_at" timestamptz NOT NULL,
        "revoked_at" timestamptz NULL,
        CONSTRAINT "api_key_pkey" PRIMARY KEY ("id")
      );
    `);
    this.addSql(`ALTER TABLE "api_key" ADD CONSTRAINT "api_key_pubkey_unique" UNIQUE ("pubkey");`);
    this.addSql(`ALTER TABLE "api_key" ADD CONSTRAINT "api_key_key_hash_unique" UNIQUE ("key_hash");`);
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "api_key";`);
  }
}
