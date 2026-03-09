import { Keypair } from '@solana/web3.js';
import { JupiterBuilder } from './jupiter.builder';

describe('JupiterBuilder', () => {
  it('has expected program metadata', () => {
    const builder = new JupiterBuilder({} as any);
    expect(builder.programName).toBe('jupiter');
    expect(builder.supportedActions).toEqual(['swap']);
  });

  it('rejects unsupported actions', async () => {
    const builder = new JupiterBuilder({} as any);
    await expect(
      builder.build(
        { action: 'transfer', from: 'x', to: 'y', amount: '1' } as any,
        {
          connection: {} as any,
          feePayer: Keypair.generate().publicKey,
          signer: Keypair.generate().publicKey,
          chain: 'solana',
          network: 'mainnet',
        },
      ),
    ).rejects.toThrow('not supported');
  });

  it('builds swap instructions using Jupiter client', async () => {
    const mockInstructions = [{} as any];
    const mockClient = {
      getQuote: jest.fn().mockResolvedValue({
        inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        outputMint: 'So11111111111111111111111111111111111111112',
        inAmount: '1000000',
        outAmount: '50000000',
        priceImpactPct: '0.01',
        routePlan: [],
      }),
      getSwapInstructions: jest.fn().mockResolvedValue({
        instructions: mockInstructions,
        addressLookupTableAddresses: ['4dPvRjD9Ns15X4yYvMhpQ2cMVLQrdAq6fegxAAjwvmjz'],
        outAmount: '50000000',
      }),
    };
    const builder = new JupiterBuilder(mockClient as any);
    const signer = Keypair.generate().publicKey;

    const result = await builder.build(
      {
        action: 'swap',
        from: signer.toBase58(),
        tokenIn: { tokenSymbol: 'USDC' },
        tokenOut: { tokenSymbol: 'SOL' },
        amountIn: '1',
      } as any,
      {
        connection: {} as any,
        feePayer: signer,
        signer,
        chain: 'solana',
        network: 'mainnet',
      },
    );

    expect(mockClient.getQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        outputMint: 'So11111111111111111111111111111111111111112',
        amount: '1000000',
        slippageBps: 10,
      }),
    );
    expect(result.instructions).toBe(mockInstructions);
    expect(result.addressLookupTableAddresses).toEqual([
      '4dPvRjD9Ns15X4yYvMhpQ2cMVLQrdAq6fegxAAjwvmjz',
    ]);
    expect(result.metadata?.outAmount).toBe('50000000');
  });

  it('applies explicit slippage', async () => {
    const mockClient = {
      getQuote: jest.fn().mockResolvedValue({
        inputMint: 'A',
        outputMint: 'B',
        inAmount: '1',
        outAmount: '2',
        priceImpactPct: '0.0',
        routePlan: [],
      }),
      getSwapInstructions: jest.fn().mockResolvedValue({
        instructions: [],
        addressLookupTableAddresses: [],
        outAmount: '2',
      }),
    };
    const builder = new JupiterBuilder(mockClient as any);
    const signer = Keypair.generate().publicKey;

    await builder.build(
      {
        action: 'swap',
        from: signer.toBase58(),
        tokenIn: { tokenSymbol: 'USDC' },
        tokenOut: { tokenSymbol: 'SOL' },
        amountIn: '1',
        slippage: 0.005,
      } as any,
      {
        connection: {} as any,
        feePayer: signer,
        signer,
        chain: 'solana',
        network: 'mainnet',
      },
    );

    expect(mockClient.getQuote).toHaveBeenCalledWith(expect.objectContaining({ slippageBps: 50 }));
  });

  it('rejects swap build outside mainnet', async () => {
    const builder = new JupiterBuilder({} as any);
    const signer = Keypair.generate().publicKey;

    await expect(
      builder.build(
        {
          action: 'swap',
          from: signer.toBase58(),
          tokenIn: { tokenSymbol: 'USDC' },
          tokenOut: { tokenSymbol: 'SOL' },
          amountIn: '1',
        } as any,
        {
          connection: {} as any,
          feePayer: signer,
          signer,
          chain: 'solana',
          network: 'devnet',
        },
      ),
    ).rejects.toThrow('mainnet');
  });
});
