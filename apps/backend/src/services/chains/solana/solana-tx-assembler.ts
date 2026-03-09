import { Injectable } from '@nestjs/common';
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

export interface AssembleParams {
  instructions: TransactionInstruction[];
  feePayer: PublicKey;
  signer: PublicKey;
  connection: Connection;
  addressLookupTableAddresses?: string[];
  computeUnits?: number;
  priorityFee?: number;
}

export interface AssembleResult {
  transaction: string;
  computeUnits: number;
  priorityFee: number;
}

const DEFAULT_CU_BUFFER = 60_000;
const DEFAULT_CU_FALLBACK = 200_000;
const DEFAULT_PRIORITY_FEE = 1000;

@Injectable()
export class SolanaTransactionAssembler {
  async assemble(params: AssembleParams): Promise<AssembleResult> {
    const lookupTableAccounts = await this.resolveAddressLookupTables(
      params.connection,
      params.addressLookupTableAddresses,
    );
    const priorityFee = params.priorityFee ?? await this.getPriorityFee(params.connection);

    const firstPassIxs = this.buildInstructionList(params.instructions, priorityFee);
    const firstPassTx = await this.buildVersionedTx(
      params.connection,
      params.feePayer,
      firstPassIxs,
      lookupTableAccounts,
    );

    const computeUnits = params.computeUnits
      ?? (await this.resolveSimulatedComputeUnits(params.connection, firstPassTx));

    const finalIxs = this.buildInstructionList(params.instructions, priorityFee, computeUnits);
    const finalTx = await this.buildVersionedTx(
      params.connection,
      params.feePayer,
      finalIxs,
      lookupTableAccounts,
    );

    return {
      transaction: Buffer.from(finalTx.serialize()).toString('base64'),
      computeUnits,
      priorityFee,
    };
  }

  private buildInstructionList(
    instructions: TransactionInstruction[],
    priorityFee: number,
    computeUnits?: number,
  ): TransactionInstruction[] {
    const result: TransactionInstruction[] = [];

    if (priorityFee > 0) {
      result.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }));
    }

    if (computeUnits) {
      result.push(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
    }

    for (const ix of instructions) {
      if (ix.programId.equals(ComputeBudgetProgram.programId)) {
        continue;
      }
      result.push(ix);
    }

    return result;
  }

  private async buildVersionedTx(
    connection: Connection,
    feePayer: PublicKey,
    instructions: TransactionInstruction[],
    lookupTableAccounts: AddressLookupTableAccount[],
  ): Promise<VersionedTransaction> {
    const blockhash = await connection.getLatestBlockhashAndContext('confirmed');
    const message = new TransactionMessage({
      payerKey: feePayer,
      recentBlockhash: blockhash.value.blockhash,
      instructions,
    }).compileToV0Message(lookupTableAccounts);

    return new VersionedTransaction(message);
  }

  private async resolveSimulatedComputeUnits(
    connection: Connection,
    tx: VersionedTransaction,
  ): Promise<number> {
    const sim = await connection.simulateTransaction(tx, {
      commitment: 'confirmed',
      replaceRecentBlockhash: true,
      sigVerify: false,
    });

    if (sim.value.err) {
      const logs = sim.value.logs?.join('\n') ?? '';
      throw new Error(`Transaction simulation failed: ${logs}`);
    }

    return (sim.value.unitsConsumed ?? DEFAULT_CU_FALLBACK) + DEFAULT_CU_BUFFER;
  }

  private async getPriorityFee(connection: Connection): Promise<number> {
    try {
      const fees = await connection.getRecentPrioritizationFees();
      if (fees.length > 0) {
        const avg = fees.reduce((sum, fee) => sum + fee.prioritizationFee, 0) / fees.length;
        const bumped = Math.ceil(avg * 1.2);
        return Math.max(DEFAULT_PRIORITY_FEE, bumped);
      }
    } catch {
      return DEFAULT_PRIORITY_FEE;
    }

    return DEFAULT_PRIORITY_FEE;
  }

  private async resolveAddressLookupTables(
    connection: Connection,
    addresses?: string[],
  ): Promise<AddressLookupTableAccount[]> {
    if (!addresses || addresses.length === 0) {
      return [];
    }

    const tables = await Promise.all(
      addresses.map(async (address) => {
        const result = await connection.getAddressLookupTable(new PublicKey(address));
        return result.value;
      }),
    );

    return tables.filter((table): table is AddressLookupTableAccount => table !== null);
  }
}
