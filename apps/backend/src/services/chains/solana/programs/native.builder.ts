import { Injectable } from '@nestjs/common';
import { PublicKey, SystemProgram, type TransactionInstruction } from '@solana/web3.js';
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { createTokenRegistry, type ActionIntent, type TransferIntent } from '@silkysquad/silk';
import type {
  ProgramBuilder,
  ProgramBuildResult,
  SolanaBuildContext,
} from '../program-builder.interface';
import { requireExactAmount, toBaseUnits } from '../amount';

@Injectable()
export class NativeBuilder implements ProgramBuilder {
  readonly programName = 'native';
  readonly supportedActions = ['transfer'];

  async build(action: ActionIntent, context: SolanaBuildContext): Promise<ProgramBuildResult> {
    if (action.action !== 'transfer') {
      throw new Error(`Action '${action.action}' is not supported by NativeBuilder`);
    }

    return this.buildTransfer(action as TransferIntent, context);
  }

  private async buildTransfer(
    intent: TransferIntent,
    context: SolanaBuildContext,
  ): Promise<ProgramBuildResult> {
    const from = new PublicKey(intent.from);
    const to = new PublicKey(intent.to);

    if (!from.equals(context.feePayer)) {
      throw new Error('For native transfers in v1, feePayer must equal intent.from');
    }

    const exactAmount = requireExactAmount(intent.amount);
    const tokenMint = await this.resolveMint(intent, context);

    if (!tokenMint) {
      const lamports = toBaseUnits(exactAmount, 9);
      return {
        instructions: [
          SystemProgram.transfer({
            fromPubkey: from,
            toPubkey: to,
            lamports,
          }),
        ],
      };
    }

    const mint = new PublicKey(tokenMint);
    const mintInfo = await getMint(context.connection, mint);
    const rawAmount = toBaseUnits(exactAmount, mintInfo.decimals);

    const sourceAta = getAssociatedTokenAddressSync(mint, from, true);
    const destinationAta = getAssociatedTokenAddressSync(mint, to, true);

    await getAccount(context.connection, sourceAta);

    const instructions: TransactionInstruction[] = [];

    try {
      await getAccount(context.connection, destinationAta);
    } catch {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          context.feePayer,
          destinationAta,
          to,
          mint,
        ),
      );
    }

    instructions.push(
      createTransferInstruction(
        sourceAta,
        destinationAta,
        from,
        rawAmount,
        [],
        TOKEN_PROGRAM_ID,
      ),
    );

    return { instructions };
  }

  private async resolveMint(intent: TransferIntent, context: SolanaBuildContext): Promise<string | null> {
    if (intent.token) {
      return intent.token;
    }

    if (!intent.tokenSymbol) {
      return null;
    }

    if (intent.tokenSymbol.toUpperCase() === 'SOL') {
      return null;
    }

    const tokenRegistry = createTokenRegistry();
    const resolved = tokenRegistry.resolveSymbol(
      context.chain,
      context.network,
      intent.tokenSymbol.toUpperCase(),
    );

    if (!resolved) {
      throw new Error(
        `Unable to resolve tokenSymbol '${intent.tokenSymbol}' on ${context.chain}:${context.network}; provide intent.token`,
      );
    }

    return resolved.address;
  }
}
