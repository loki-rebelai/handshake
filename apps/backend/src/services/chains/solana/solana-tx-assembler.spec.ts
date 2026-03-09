import {
  ComputeBudgetProgram,
  Keypair,
  SystemProgram,
  VersionedTransaction,
} from '@solana/web3.js';
import { SolanaTransactionAssembler } from './solana-tx-assembler';

describe('SolanaTransactionAssembler', () => {
  const makeAssembler = (connectionOverrides: Record<string, jest.Mock> = {}) => {
    const connection = {
      getLatestBlockhashAndContext: jest.fn().mockResolvedValue({
        context: { slot: 100 },
        value: {
          blockhash: '11111111111111111111111111111111',
          lastValidBlockHeight: 200,
        },
      }),
      getAddressLookupTable: jest.fn().mockResolvedValue({ value: null }),
      getRecentPrioritizationFees: jest.fn().mockResolvedValue([{ prioritizationFee: 1000 }]),
      simulateTransaction: jest.fn().mockResolvedValue({
        value: { err: null, unitsConsumed: 50_000, logs: [] },
      }),
      ...connectionOverrides,
    } as any;

    return { assembler: new SolanaTransactionAssembler(), connection };
  };

  it('assembles a base64 versioned transaction', async () => {
    const { assembler, connection } = makeAssembler();
    const feePayer = Keypair.generate().publicKey;
    const ix = SystemProgram.transfer({
      fromPubkey: feePayer,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1000,
    });

    const result = await assembler.assemble({
      instructions: [ix],
      feePayer,
      signer: feePayer,
      connection,
    });

    expect(typeof result.transaction).toBe('string');
    expect(() => Buffer.from(result.transaction, 'base64')).not.toThrow();
    expect(result.computeUnits).toBeGreaterThan(0);
    expect(result.priorityFee).toBeGreaterThan(0);
  });

  it('injects compute budget instructions using simulation units', async () => {
    const { assembler, connection } = makeAssembler({
      simulateTransaction: jest.fn().mockResolvedValue({
        value: { err: null, unitsConsumed: 75_000, logs: [] },
      }),
    });
    const feePayer = Keypair.generate().publicKey;
    const ix = SystemProgram.transfer({
      fromPubkey: feePayer,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1000,
    });

    const result = await assembler.assemble({
      instructions: [ix],
      feePayer,
      signer: feePayer,
      connection,
    });
    const tx = VersionedTransaction.deserialize(Buffer.from(result.transaction, 'base64'));
    const programIds = tx.message.compiledInstructions.map(
      (compiled) => tx.message.staticAccountKeys[compiled.programIdIndex].toBase58(),
    );
    const computeIxCount = programIds.filter(
      (programId) => programId === ComputeBudgetProgram.programId.toBase58(),
    ).length;

    expect(result.computeUnits).toBeGreaterThanOrEqual(75_000);
    expect(computeIxCount).toBe(2);
  });

  it('throws when simulation fails', async () => {
    const { assembler, connection } = makeAssembler({
      simulateTransaction: jest.fn().mockResolvedValue({
        value: {
          err: { InstructionError: [0, 'InvalidAccountData'] },
          unitsConsumed: 0,
          logs: ['Program failed'],
        },
      }),
    });
    const feePayer = Keypair.generate().publicKey;
    const ix = SystemProgram.transfer({
      fromPubkey: feePayer,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1000,
    });

    await expect(
      assembler.assemble({
        instructions: [ix],
        feePayer,
        signer: feePayer,
        connection,
      }),
    ).rejects.toThrow('simulation');
  });
});
