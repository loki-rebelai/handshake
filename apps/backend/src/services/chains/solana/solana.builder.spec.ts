import { Keypair, TransactionInstruction } from '@solana/web3.js';
import { SolanaBuilder } from './solana.builder';

describe('SolanaBuilder', () => {
  const mockAssembler = {
    assemble: jest.fn().mockResolvedValue({
      transaction: 'base64encodedtx',
      computeUnits: 100000,
      priorityFee: 1000,
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('has chain set to solana', () => {
    const builder = new SolanaBuilder(
      { getConnection: jest.fn() } as any,
      { programName: 'native', supportedActions: ['transfer'], build: jest.fn() } as any,
      { programName: 'handshake', supportedActions: ['transfer'], build: jest.fn() } as any,
      { programName: 'jupiter', supportedActions: ['swap'], build: jest.fn() } as any,
      mockAssembler as any,
    );

    expect(builder.chain).toBe('solana');
  });

  it('rejects intents for non-solana chains', async () => {
    const builder = new SolanaBuilder(
      { getConnection: jest.fn() } as any,
      { programName: 'native', supportedActions: ['transfer'], build: jest.fn() } as any,
      { programName: 'handshake', supportedActions: ['transfer'], build: jest.fn() } as any,
      { programName: 'jupiter', supportedActions: ['swap'], build: jest.fn() } as any,
      mockAssembler as any,
    );

    await expect(
      builder.build({ chain: 'ethereum', action: 'transfer', from: 'x', to: 'y', amount: '1' } as any),
    ).rejects.toThrow('solana');
  });

  it('uses native builder by default', async () => {
    const from = Keypair.generate().publicKey;
    const nativeBuild = jest.fn().mockResolvedValue({
      instructions: [
        new TransactionInstruction({
          programId: Keypair.generate().publicKey,
          keys: [],
          data: Buffer.alloc(0),
        }),
      ],
    });

    const builder = new SolanaBuilder(
      { getConnection: jest.fn().mockReturnValue({}) } as any,
      { programName: 'native', supportedActions: ['transfer'], build: nativeBuild } as any,
      { programName: 'handshake', supportedActions: ['transfer'], build: jest.fn() } as any,
      { programName: 'jupiter', supportedActions: ['swap'], build: jest.fn() } as any,
      mockAssembler as any,
    );

    const result = await builder.build({
      chain: 'solana',
      action: 'transfer',
      from: from.toBase58(),
      to: Keypair.generate().publicKey.toBase58(),
      amount: '1',
    } as any);

    expect(nativeBuild).toHaveBeenCalled();
    expect(mockAssembler.assemble).toHaveBeenCalled();
    expect(result.metadata.programName).toBe('native');
    expect(result.transaction).toBe('base64encodedtx');
  });

  it('routes swap actions to Jupiter by default', async () => {
    const from = Keypair.generate().publicKey;
    const jupiterBuild = jest.fn().mockResolvedValue({ instructions: [] });

    const builder = new SolanaBuilder(
      { getConnection: jest.fn().mockReturnValue({}) } as any,
      { programName: 'native', supportedActions: ['transfer'], build: jest.fn() } as any,
      { programName: 'handshake', supportedActions: ['transfer'], build: jest.fn() } as any,
      { programName: 'jupiter', supportedActions: ['swap'], build: jupiterBuild } as any,
      mockAssembler as any,
    );

    await builder.build({
      chain: 'solana',
      action: 'swap',
      from: from.toBase58(),
      tokenIn: { tokenSymbol: 'USDC' },
      tokenOut: { tokenSymbol: 'SOL' },
      amountIn: '1',
    } as any);

    expect(jupiterBuild).toHaveBeenCalled();
  });
});
