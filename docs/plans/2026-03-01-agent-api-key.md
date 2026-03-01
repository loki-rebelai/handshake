# Agent API Key Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Solana-signature-based API key authentication to the SilkyWay backend — agents register with their keypair and receive a long-lived API key required on all requests.

**Architecture:** Agents prove identity via a challenge-response flow (GET nonce → sign → POST signature → receive key). A global NestJS `ApiKeyGuard` protects every route; auth endpoints are whitelisted with `@Public()`. Keys are stored as SHA-256 hashes; raw key is returned once at registration.

**Tech Stack:** NestJS, MikroORM/PostgreSQL, tweetnacl (ed25519 sig verify), Node.js `crypto` (key gen + hashing), `@solana/web3.js` (pubkey validation)

---

### Task 1: Add tweetnacl dependency

**Files:**
- Modify: `apps/backend/package.json` (via npm install)

**Step 1: Install tweetnacl**

From `apps/backend/`:
```bash
npm install tweetnacl
```

Expected: `tweetnacl` added to `dependencies` in `package.json`.

**Step 2: Verify import works**

```bash
node -e "const nacl = require('tweetnacl'); console.log(typeof nacl.sign.detached.verify)"
```

Expected output: `function`

**Step 3: Commit**

```bash
git add apps/backend/package.json apps/backend/package-lock.json
git commit -m "chore: add tweetnacl as direct dependency"
```

---

### Task 2: Create ApiKey entity

**Files:**
- Create: `apps/backend/src/db/models/ApiKey.ts`

**Step 1: Create the entity**

```typescript
// apps/backend/src/db/models/ApiKey.ts
import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { v4 } from 'uuid';

@Entity()
export class ApiKey {
  @PrimaryKey()
  id: string = v4();

  @Property({ unique: true })
  pubkey!: string;

  @Property({ unique: true })
  keyHash!: string;

  @Property()
  createdAt: Date = new Date();

  @Property({ nullable: true })
  revokedAt?: Date;

  constructor(pubkey: string, keyHash: string) {
    this.pubkey = pubkey;
    this.keyHash = keyHash;
  }
}
```

**Step 2: Verify TypeScript compiles**

From `apps/backend/`:
```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add apps/backend/src/db/models/ApiKey.ts
git commit -m "feat: add ApiKey entity"
```

---

### Task 3: Create database migration

**Files:**
- Create: `apps/backend/migrations/Migration20260301120000.ts`

**Step 1: Create the migration**

```typescript
// apps/backend/migrations/Migration20260301120000.ts
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
```

**Step 2: Run the migration**

From `apps/backend/`:
```bash
npx mikro-orm migration:up
```

Expected: `Migration20260301120000 successfully migrated`

**Step 3: Commit**

```bash
git add apps/backend/migrations/Migration20260301120000.ts
git commit -m "feat: add api_key table migration"
```

---

### Task 4: Create AuthService with unit tests (TDD)

**Files:**
- Create: `apps/backend/src/api/auth/auth.service.spec.ts`
- Create: `apps/backend/src/api/auth/auth.service.ts`

**Step 1: Write the failing tests**

```typescript
// apps/backend/src/api/auth/auth.service.spec.ts
import { AuthService } from './auth.service';

// Minimal mock for EntityManager
function makeMockEm(existing: any = null) {
  const record = existing ? { ...existing } : null;
  return {
    findOne: jest.fn().mockResolvedValue(record),
    persist: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
  };
}

describe('AuthService', () => {
  describe('generateChallenge', () => {
    it('returns a nonce starting with silk_', () => {
      const service = new AuthService(makeMockEm() as any);
      const nonce = service.generateChallenge('11111111111111111111111111111111');
      expect(nonce).toMatch(/^silk_/);
    });

    it('returns a different nonce each time', () => {
      const service = new AuthService(makeMockEm() as any);
      const pubkey = '11111111111111111111111111111111';
      const n1 = service.generateChallenge(pubkey);
      const n2 = service.generateChallenge(pubkey);
      expect(n1).not.toBe(n2);
    });
  });

  describe('validateKey', () => {
    it('returns null for unknown key', async () => {
      const service = new AuthService(makeMockEm(null) as any);
      const result = await service.validateKey('sw_unknownkey');
      expect(result).toBeNull();
    });

    it('returns pubkey for valid non-revoked key', async () => {
      const { createHash } = require('crypto');
      const rawKey = 'sw_testkey';
      const keyHash = createHash('sha256').update(rawKey).digest('hex');
      const em = makeMockEm({ pubkey: 'testpubkey', keyHash, revokedAt: undefined });
      const service = new AuthService(em as any);
      const result = await service.validateKey(rawKey);
      expect(result).toEqual({ pubkey: 'testpubkey' });
    });

    it('returns null for revoked key', async () => {
      const { createHash } = require('crypto');
      const rawKey = 'sw_revokedkey';
      const keyHash = createHash('sha256').update(rawKey).digest('hex');
      const em = makeMockEm({ pubkey: 'testpubkey', keyHash, revokedAt: new Date() });
      const service = new AuthService(em as any);
      const result = await service.validateKey(rawKey);
      expect(result).toBeNull();
    });
  });

  describe('revokeKey', () => {
    it('throws if key not found', async () => {
      const service = new AuthService(makeMockEm(null) as any);
      await expect(service.revokeKey('sw_unknown')).rejects.toThrow('Key not found');
    });

    it('sets revokedAt on the record', async () => {
      const { createHash } = require('crypto');
      const rawKey = 'sw_activekey';
      const keyHash = createHash('sha256').update(rawKey).digest('hex');
      const record = { pubkey: 'testpubkey', keyHash, revokedAt: undefined };
      const em = makeMockEm(record);
      const service = new AuthService(em as any);
      await service.revokeKey(rawKey);
      expect(record.revokedAt).toBeInstanceOf(Date);
      expect(em.flush).toHaveBeenCalled();
    });
  });
});
```

**Step 2: Run tests to verify they fail**

From `apps/backend/`:
```bash
npx jest src/api/auth/auth.service.spec.ts --no-coverage
```

Expected: FAIL — `Cannot find module './auth.service'`

**Step 3: Implement AuthService**

```typescript
// apps/backend/src/api/auth/auth.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository, EntityManager } from '@mikro-orm/postgresql';
import { createHash, randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import nacl from 'tweetnacl';
import { PublicKey } from '@solana/web3.js';
import { ApiKey } from '../../db/models/ApiKey';

interface ChallengeEntry {
  nonce: string;
  expiresAt: number;
}

@Injectable()
export class AuthService {
  private readonly challenges = new Map<string, ChallengeEntry>();

  constructor(private readonly em: EntityManager) {}

  generateChallenge(pubkey: string): string {
    const nonce = `silk_${uuidv4()}`;
    this.challenges.set(pubkey, { nonce, expiresAt: Date.now() + 60_000 });
    return nonce;
  }

  async verifyAndIssueKey(pubkey: string, signature: string): Promise<string> {
    const entry = this.challenges.get(pubkey);
    if (!entry || Date.now() > entry.expiresAt) {
      throw new Error('No valid challenge found — call /api/auth/challenge first');
    }
    this.challenges.delete(pubkey);

    const messageBytes = Buffer.from(entry.nonce, 'utf-8');
    const signatureBytes = Buffer.from(signature, 'base64');
    const pubkeyBytes = new PublicKey(pubkey).toBytes();

    const valid = nacl.sign.detached.verify(messageBytes, signatureBytes, pubkeyBytes);
    if (!valid) {
      throw new Error('Signature verification failed');
    }

    const rawKey = `sw_${randomBytes(32).toString('hex')}`;
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    let record = await this.em.findOne(ApiKey, { pubkey });
    if (record) {
      record.keyHash = keyHash;
      record.createdAt = new Date();
      record.revokedAt = undefined;
    } else {
      record = new ApiKey(pubkey, keyHash);
      this.em.persist(record);
    }
    await this.em.flush();

    return rawKey;
  }

  async validateKey(rawKey: string): Promise<{ pubkey: string } | null> {
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const record = await this.em.findOne(ApiKey, { keyHash });
    if (!record || record.revokedAt) return null;
    return { pubkey: record.pubkey };
  }

  async revokeKey(rawKey: string): Promise<void> {
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const record = await this.em.findOne(ApiKey, { keyHash });
    if (!record) throw new Error('Key not found');
    record.revokedAt = new Date();
    await this.em.flush();
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
npx jest src/api/auth/auth.service.spec.ts --no-coverage
```

Expected: PASS — all 6 tests green.

**Step 5: Commit**

```bash
git add apps/backend/src/api/auth/
git commit -m "feat: add AuthService with challenge/register/revoke/validate logic"
```

---

### Task 5: Create @Public() decorator and ApiKeyGuard

**Files:**
- Create: `apps/backend/src/api/auth/public.decorator.ts`
- Create: `apps/backend/src/api/auth/auth.guard.ts`

**Step 1: Create the @Public() decorator**

```typescript
// apps/backend/src/api/auth/public.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

**Step 2: Create the ApiKeyGuard**

```typescript
// apps/backend/src/api/auth/auth.guard.ts
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { AuthService } from './auth.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers['authorization'];

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        ok: false,
        error: 'MISSING_API_KEY',
        message: 'Authorization: Bearer <api-key> header required',
      });
    }

    const rawKey = authHeader.slice(7);
    const agent = await this.authService.validateKey(rawKey);

    if (!agent) {
      throw new UnauthorizedException({
        ok: false,
        error: 'INVALID_API_KEY',
        message: 'Invalid or revoked API key',
      });
    }

    request.agent = agent;
    return true;
  }
}
```

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 4: Commit**

```bash
git add apps/backend/src/api/auth/public.decorator.ts apps/backend/src/api/auth/auth.guard.ts
git commit -m "feat: add ApiKeyGuard and @Public() decorator"
```

---

### Task 6: Create AuthController

**Files:**
- Create: `apps/backend/src/api/auth/auth.controller.ts`

**Step 1: Create the controller**

```typescript
// apps/backend/src/api/auth/auth.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Headers,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import { Public } from './public.decorator';
import { AuthService } from './auth.service';

@Controller('api/auth')
@Public()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('challenge')
  challenge(@Query('pubkey') pubkey: string) {
    if (!pubkey) {
      throw new BadRequestException({ ok: false, error: 'MISSING_FIELD', message: 'pubkey is required' });
    }
    try {
      new PublicKey(pubkey);
    } catch {
      throw new BadRequestException({ ok: false, error: 'INVALID_PUBKEY', message: 'pubkey is not a valid public key' });
    }

    const nonce = this.authService.generateChallenge(pubkey);
    return { ok: true, data: { nonce } };
  }

  @Post('register')
  async register(@Body() body: { pubkey: string; signature: string }) {
    if (!body?.pubkey || !body?.signature) {
      throw new BadRequestException({ ok: false, error: 'MISSING_FIELD', message: 'pubkey and signature are required' });
    }
    try {
      new PublicKey(body.pubkey);
    } catch {
      throw new BadRequestException({ ok: false, error: 'INVALID_PUBKEY', message: 'pubkey is not a valid public key' });
    }

    try {
      const apiKey = await this.authService.verifyAndIssueKey(body.pubkey, body.signature);
      return { ok: true, data: { apiKey } };
    } catch (e: any) {
      throw new UnauthorizedException({ ok: false, error: 'INVALID_SIGNATURE', message: e.message });
    }
  }

  @Post('revoke')
  async revoke(@Headers('authorization') auth: string) {
    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException({ ok: false, error: 'MISSING_API_KEY', message: 'Authorization header required' });
    }
    const rawKey = auth.slice(7);
    try {
      await this.authService.revokeKey(rawKey);
    } catch {
      throw new UnauthorizedException({ ok: false, error: 'INVALID_API_KEY', message: 'Key not found' });
    }
    return { ok: true };
  }
}
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add apps/backend/src/api/auth/auth.controller.ts
git commit -m "feat: add AuthController (challenge, register, revoke)"
```

---

### Task 7: Wire everything into modules

**Files:**
- Modify: `apps/backend/src/api/api.module.ts`
- Modify: `apps/backend/src/app.module.ts`

**Step 1: Update ApiModule**

Replace the content of `apps/backend/src/api/api.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Transfer } from '../db/models/Transfer';
import { Pool } from '../db/models/Pool';
import { Token } from '../db/models/Token';
import { SilkAccount } from '../db/models/SilkAccount';
import { SilkAccountOperator } from '../db/models/SilkAccountOperator';
import { SilkAccountEvent } from '../db/models/SilkAccountEvent';
import { ApiKey } from '../db/models/ApiKey';
import { TxController } from './controller/tx.controller';
import { TransferController } from './controller/transfer.controller';
import { TokenController } from './controller/token.controller';
import { WalletController } from './controller/wallet.controller';
import { AccountController } from './controller/account.controller';
import { WellKnownController } from './controller/well-known.controller';
import { AuthController } from './auth/auth.controller';
import { TxService } from './service/tx.service';
import { TransferService } from './service/transfer.service';
import { TokenService } from './service/token.service';
import { WalletService } from './service/wallet.service';
import { AccountService } from './service/account.service';
import { AuthService } from './auth/auth.service';

@Module({
  imports: [
    MikroOrmModule.forFeature([Transfer, Pool, Token, SilkAccount, SilkAccountOperator, SilkAccountEvent, ApiKey]),
  ],
  controllers: [
    TxController,
    TransferController,
    TokenController,
    WalletController,
    AccountController,
    WellKnownController,
    AuthController,
  ],
  providers: [TxService, TransferService, TokenService, WalletService, AccountService, AuthService],
  exports: [AuthService],
})
export class ApiModule {}
```

**Step 2: Register global guard in AppModule**

Replace the content of `apps/backend/src/app.module.ts`:

```typescript
import { Module, Logger } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { ContentModule } from './content/content.module';
import { SolanaModule } from './solana/solana.module';
import { ApiModule } from './api/api.module';
import { ChatModule } from './chat/chat.module';
import { ApiKeyGuard } from './api/auth/auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.ENV_FILE || '.env',
    }),
    MikroOrmModule.forRoot({}),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      serveRoot: '/',
      serveStaticOptions: { index: false },
    }),
    ContentModule,
    SolanaModule,
    ApiModule,
    ChatModule,
  ],
  providers: [
    Logger,
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
  ],
})
export class AppModule {}
```

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 4: Run tests**

```bash
npx jest --no-coverage
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add apps/backend/src/api/api.module.ts apps/backend/src/app.module.ts
git commit -m "feat: wire ApiKeyGuard globally and register auth module"
```

---

### Task 8: Smoke test end-to-end

**Step 1: Start the server**

From `apps/backend/`:
```bash
npm run start:dev
```

**Step 2: Verify auth endpoints are public**

```bash
curl http://localhost:3000/api/auth/challenge?pubkey=11111111111111111111111111111111
```

Expected: `{"ok":true,"data":{"nonce":"silk_<uuid>"}}`

**Step 3: Verify protected endpoints require auth**

```bash
curl http://localhost:3000/api/wallet/11111111111111111111111111111111/balance
```

Expected: `{"ok":false,"error":"MISSING_API_KEY","message":"..."}` with HTTP 401.

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: agent API key authentication — complete"
```
