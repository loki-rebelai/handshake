import { of } from 'rxjs';
import { Keypair } from '@solana/web3.js';
import { JupiterClient } from './jupiter-client';

describe('JupiterClient', () => {
  const mockHttpService = {
    get: jest.fn(),
    post: jest.fn(),
  };
  const mockConfigService = {
    get: jest.fn((key: string, fallback: string) => {
      if (key === 'JUPITER_API_KEY') {
        return 'test-api-key';
      }
      return fallback;
    }),
  };

  const makeClient = () => new JupiterClient(mockHttpService as any, mockConfigService as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls Jupiter quote API with expected params', async () => {
    mockHttpService.get.mockReturnValue(
      of({
        data: {
          inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          outputMint: 'So11111111111111111111111111111111111111112',
          inAmount: '1000000',
          outAmount: '50000000',
          otherAmountThreshold: '49500000',
          swapMode: 'ExactIn',
          slippageBps: 10,
          priceImpactPct: '0.01',
          routePlan: [],
          contextSlot: 100,
          timeTaken: 0.5,
        },
      }),
    );

    const client = makeClient();
    const result = await client.getQuote({
      inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      outputMint: 'So11111111111111111111111111111111111111112',
      amount: '1000000',
      slippageBps: 10,
    });

    expect(result.outAmount).toBe('50000000');
    expect(mockHttpService.get).toHaveBeenCalledWith(
      expect.stringContaining('/quote'),
      expect.objectContaining({
        params: expect.objectContaining({
          inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          outputMint: 'So11111111111111111111111111111111111111112',
          amount: '1000000',
          slippageBps: 10,
        }),
      }),
    );
  });

  it('calls swap-instructions API and converts instructions', async () => {
    const programId = Keypair.generate().publicKey.toBase58();
    const account = Keypair.generate().publicKey.toBase58();

    mockHttpService.post.mockReturnValue(
      of({
        data: {
          computeBudgetInstructions: [],
          otherInstructions: [],
          setupInstructions: [],
          swapInstruction: {
            programId,
            accounts: [{ pubkey: account, isSigner: false, isWritable: true }],
            data: Buffer.from('swap').toString('base64'),
          },
          addressLookupTableAddresses: ['4dPvRjD9Ns15X4yYvMhpQ2cMVLQrdAq6fegxAAjwvmjz'],
          cleanupInstruction: null,
        },
      }),
    );

    const client = makeClient();
    const result = await client.getSwapInstructions({
      quote: {
        inputMint: 'A',
        outputMint: 'B',
        inAmount: '1',
        outAmount: '2',
      } as any,
      signer: Keypair.generate().publicKey.toBase58(),
    });

    expect(result.instructions).toHaveLength(1);
    expect(result.addressLookupTableAddresses).toEqual([
      '4dPvRjD9Ns15X4yYvMhpQ2cMVLQrdAq6fegxAAjwvmjz',
    ]);
    expect(result.outAmount).toBe('2');
  });
});
