import { HttpService } from '@nestjs/axios';
import { Keypair } from '@solana/web3.js';
import { JupiterClient } from '../jupiter-client';
import { JupiterBuilder } from './jupiter.builder';

const describeIf = process.env.INTEGRATION_TESTS ? describe : describe.skip;

describeIf('JupiterBuilder (integration)', () => {
  let builder: JupiterBuilder;

  beforeAll(() => {
    const httpService = new HttpService();
    const configService = {
      get: (_key: string, fallback?: string) => fallback ?? '',
    } as any;
    const client = new JupiterClient(httpService, configService);
    builder = new JupiterBuilder(client);
  });

  it('builds a USDC->SOL swap intent', async () => {
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

    expect(result.instructions.length).toBeGreaterThan(0);
    expect(result.addressLookupTableAddresses?.length).toBeGreaterThan(0);
    expect(result.metadata?.outAmount).toBeDefined();
  }, 30_000);
});
