import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BN } from '@coral-xyz/anchor';
import { getMint } from '@solana/spl-token';
import { PublicKey, type TransactionInstruction } from '@solana/web3.js';
import type { ActionIntent, TransferIntent } from '@silkysquad/silk';
import { generateNamedPoolId, HandshakeClient } from '../../../../solana/handshake-client';
import { SolanaService } from '../../../../solana/solana.service';
import type {
  ProgramBuilder,
  ProgramBuildResult,
  SolanaBuildContext,
} from '../program-builder.interface';
import { requireExactAmount, toBaseUnits } from '../amount';

type HandshakeTransferIntent = TransferIntent & {
  poolPda?: string;
  nonce?: string | number;
  claimableAfter?: number;
  claimableUntil?: number;
};

@Injectable()
export class HandshakeBuilder implements ProgramBuilder {
  readonly programName = 'handshake';
  readonly supportedActions = ['transfer'];

  constructor(
    private readonly solanaService: SolanaService,
    private readonly configService: ConfigService,
  ) {}

  async build(action: ActionIntent, context: SolanaBuildContext): Promise<ProgramBuildResult> {
    if (action.action !== 'transfer') {
      throw new Error(`Action '${action.action}' is not supported by HandshakeBuilder`);
    }

    return this.buildCreateTransfer(action as HandshakeTransferIntent, context);
  }

  private async buildCreateTransfer(
    intent: HandshakeTransferIntent,
    context: SolanaBuildContext,
  ): Promise<ProgramBuildResult> {
    const sender = context.feePayer;
    const from = new PublicKey(intent.from);

    if (!from.equals(sender)) {
      throw new Error('For handshake transfers in v1, feePayer must equal intent.from');
    }

    const recipient = new PublicKey(intent.to);
    const poolPda = await this.resolvePoolPda(intent);

    const client = this.solanaService.getHandshakeClient();
    const pool = await client.fetchPool(poolPda);
    if (!pool) {
      throw new Error(`Pool ${poolPda.toBase58()} not found on-chain`);
    }

    const mintInfo = await getMint(context.connection, pool.mint);
    const exactAmount = requireExactAmount(intent.amount);
    const amountRaw = new BN(toBaseUnits(exactAmount, mintInfo.decimals).toString());

    const nonce = this.resolveNonce(intent.nonce);
    const claimableAfter = intent.claimableAfter ?? 0;
    const claimableUntil = intent.claimableUntil ?? 0;

    const { ix } = await client.getCreateTransferIx(
      sender,
      recipient,
      poolPda,
      nonce,
      amountRaw,
      intent.memo || '',
      claimableAfter,
      claimableUntil,
    );

    return { instructions: [ix] };
  }

  private async resolvePoolPda(intent: HandshakeTransferIntent): Promise<PublicKey> {
    if (intent.poolPda) {
      return new PublicKey(intent.poolPda);
    }

    const defaultPoolName = this.configService.get<string>('HANDSHAKE_POOL_NAME');
    if (!defaultPoolName) {
      throw new Error('Handshake build requires intent.poolPda or HANDSHAKE_POOL_NAME in environment');
    }

    const client: HandshakeClient = this.solanaService.getHandshakeClient();
    const poolId = generateNamedPoolId(defaultPoolName);
    const [poolPda] = client.findPoolPda(poolId);
    return poolPda;
  }

  private resolveNonce(nonce?: string | number): BN {
    if (nonce === undefined) {
      return new BN(Date.now());
    }

    if (typeof nonce === 'number') {
      return new BN(nonce);
    }

    if (!/^\d+$/.test(nonce)) {
      throw new Error(`Invalid nonce '${nonce}'. Expected an unsigned integer.`);
    }

    return new BN(nonce);
  }
}
