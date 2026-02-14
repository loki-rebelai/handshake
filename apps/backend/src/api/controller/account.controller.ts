import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import { AccountService } from '../service/account.service';
import { SilkAccountEventType } from '../../db/models/SilkAccountEvent';

@Controller('api/account')
export class AccountController {
  private readonly logger = new Logger(AccountController.name);

  constructor(private readonly accountService: AccountService) {}

  @Get('by-operator/:pubkey')
  async getByOperator(@Param('pubkey') pubkey: string) {
    this.validatePubkey(pubkey, 'pubkey');

    const results = await this.accountService.getAccountsByOperator(pubkey);

    const accounts = results.map((r) => {
      const operatorPubkey = new PublicKey(pubkey);
      let operatorSlot: { index: number; perTxLimit: string } | null = null;

      for (let i = 0; i < r.account.operatorCount; i++) {
        const slot = r.account.operators[i];
        if (slot.pubkey.equals(operatorPubkey)) {
          operatorSlot = {
            index: i,
            perTxLimit: slot.perTxLimit.toString(),
          };
          break;
        }
      }

      return {
        pda: r.pda.toBase58(),
        owner: r.account.owner.toBase58(),
        mint: r.account.mint.toBase58(),
        mintDecimals: r.mintDecimals,
        isPaused: r.account.isPaused,
        balance: r.balance,
        operatorSlot,
        driftUser: r.account.driftUser?.toBase58() ?? null,
        principalBalance: r.account.principalBalance.toString(),
      };
    });

    return { ok: true, data: { accounts } };
  }

  @Get('list')
  async listAccounts(@Query('owner') owner: string) {
    this.validatePubkey(owner, 'owner');

    const accounts = await this.accountService.findAccountsByOwner(owner);
    return {
      ok: true,
      data: {
        accounts: accounts.map((a) => ({
          id: a.id,
          pda: a.pda,
          owner: a.owner,
          mint: a.mint,
          status: a.status,
          operators: a.operators.getItems().map((op) => ({
            operator: op.operator,
            perTxLimit: op.perTxLimit,
            createdAt: op.createdAt,
          })),
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
        })),
      },
    };
  }

  @Get(':pda/events')
  async getEvents(
    @Param('pda') pda: string,
    @Query('eventType') eventType?: string,
  ) {
    this.validatePubkey(pda, 'pda');

    const validType = eventType && Object.values(SilkAccountEventType).includes(eventType as SilkAccountEventType)
      ? (eventType as SilkAccountEventType)
      : undefined;

    const events = await this.accountService.findEventsByAccount(pda, validType);
    return {
      ok: true,
      data: {
        events: events.map((e) => ({
          id: e.id,
          eventType: e.eventType,
          txid: e.txid,
          actor: e.actor,
          data: e.data,
          createdAt: e.createdAt,
        })),
      },
    };
  }

  @Get(':pda')
  async getAccount(@Param('pda') pda: string) {
    this.validatePubkey(pda, 'pda');

    const result = await this.accountService.getAccount(pda);
    if (!result) {
      throw new NotFoundException({ ok: false, error: 'ACCOUNT_NOT_FOUND', message: 'Account not found' });
    }

    const operators: Array<{ index: number; pubkey: string; perTxLimit: string }> = [];
    for (let i = 0; i < result.account.operatorCount; i++) {
      const slot = result.account.operators[i];
      operators.push({
        index: i,
        pubkey: slot.pubkey.toBase58(),
        perTxLimit: slot.perTxLimit.toString(),
      });
    }

    return {
      ok: true,
      data: {
        pda: result.pda,
        owner: result.account.owner.toBase58(),
        mint: result.account.mint.toBase58(),
        mintDecimals: result.mintDecimals,
        isPaused: result.account.isPaused,
        balance: result.balance,
        operators,
        driftUser: result.account.driftUser?.toBase58() ?? null,
        driftMarketIndex: result.account.driftMarketIndex ?? null,
        principalBalance: result.account.principalBalance.toString(),
      },
    };
  }

  @Post('create')
  @HttpCode(200)
  async createAccount(
    @Body() body: { owner: string; mint: string; operator?: string; perTxLimit?: number },
  ) {
    this.validatePubkey(body.owner, 'owner');
    this.validatePubkey(body.mint, 'mint');
    if (body.operator) this.validatePubkey(body.operator, 'operator');
    if (body.perTxLimit != null && body.perTxLimit < 0) {
      throw new BadRequestException({ ok: false, error: 'INVALID_LIMIT', message: 'perTxLimit must be >= 0' });
    }

    const data = await this.accountService.buildCreateAccountTx(body);
    return { ok: true, data };
  }

  @Post('deposit')
  @HttpCode(200)
  async deposit(
    @Body() body: { depositor: string; accountPda: string; amount: number },
  ) {
    this.validatePubkey(body.depositor, 'depositor');
    this.validatePubkey(body.accountPda, 'accountPda');
    if (!body.amount || body.amount <= 0) {
      throw new BadRequestException({ ok: false, error: 'INVALID_AMOUNT', message: 'Amount must be positive' });
    }

    const data = await this.accountService.buildDepositTx(body);
    return { ok: true, data };
  }

  @Post('transfer')
  @HttpCode(200)
  async transfer(
    @Body() body: { signer: string; accountPda: string; recipient: string; amount: number },
  ) {
    this.validatePubkey(body.signer, 'signer');
    this.validatePubkey(body.accountPda, 'accountPda');
    this.validatePubkey(body.recipient, 'recipient');
    if (!body.amount || body.amount <= 0) {
      throw new BadRequestException({ ok: false, error: 'INVALID_AMOUNT', message: 'Amount must be positive' });
    }

    const data = await this.accountService.buildTransferFromAccountTx(body);
    return { ok: true, data };
  }

  @Post('pause')
  @HttpCode(200)
  async togglePause(@Body() body: { owner: string; accountPda: string }) {
    this.validatePubkey(body.owner, 'owner');
    this.validatePubkey(body.accountPda, 'accountPda');

    const data = await this.accountService.buildTogglePauseTx(body);
    return { ok: true, data };
  }

  @Post('add-operator')
  @HttpCode(200)
  async addOperator(
    @Body() body: { owner: string; accountPda: string; operator: string; perTxLimit?: number },
  ) {
    this.validatePubkey(body.owner, 'owner');
    this.validatePubkey(body.accountPda, 'accountPda');
    this.validatePubkey(body.operator, 'operator');
    if (body.perTxLimit != null && body.perTxLimit < 0) {
      throw new BadRequestException({ ok: false, error: 'INVALID_LIMIT', message: 'perTxLimit must be >= 0' });
    }

    const data = await this.accountService.buildAddOperatorTx(body);
    return { ok: true, data };
  }

  @Post('remove-operator')
  @HttpCode(200)
  async removeOperator(
    @Body() body: { owner: string; accountPda: string; operator: string },
  ) {
    this.validatePubkey(body.owner, 'owner');
    this.validatePubkey(body.accountPda, 'accountPda');
    this.validatePubkey(body.operator, 'operator');

    const data = await this.accountService.buildRemoveOperatorTx(body);
    return { ok: true, data };
  }

  @Post('close')
  @HttpCode(200)
  async closeAccount(@Body() body: { owner: string; accountPda: string }) {
    this.validatePubkey(body.owner, 'owner');
    this.validatePubkey(body.accountPda, 'accountPda');

    const data = await this.accountService.buildCloseAccountTx(body);
    return { ok: true, data };
  }

  private validatePubkey(value: string, field: string) {
    if (!value) {
      throw new BadRequestException({ ok: false, error: 'MISSING_FIELD', message: `${field} is required` });
    }
    try {
      new PublicKey(value);
    } catch {
      throw new BadRequestException({ ok: false, error: 'INVALID_PUBKEY', message: `${field} is not a valid public key` });
    }
  }
}
