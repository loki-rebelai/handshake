import { Keypair, SystemProgram } from '@solana/web3.js';
import { NativeBuilder } from './native.builder';

describe('NativeBuilder', () => {
  it('has expected program metadata', () => {
    const builder = new NativeBuilder();
    expect(builder.programName).toBe('native');
    expect(builder.supportedActions).toEqual(['transfer']);
  });

  it('rejects unsupported actions', async () => {
    const builder = new NativeBuilder();
    await expect(
      builder.build(
        { action: 'swap', from: 'x' } as any,
        {
          connection: {} as any,
          feePayer: Keypair.generate().publicKey,
          signer: Keypair.generate().publicKey,
          chain: 'solana',
          network: 'mainnet',
        },
      ),
    ).rejects.toThrow("not supported");
  });

  it('builds a native SOL transfer instruction', async () => {
    const builder = new NativeBuilder();
    const from = Keypair.generate().publicKey;
    const to = Keypair.generate().publicKey;

    const result = await builder.build(
      {
        action: 'transfer',
        from: from.toBase58(),
        to: to.toBase58(),
        amount: '1.5',
      } as any,
      {
        connection: {} as any,
        feePayer: from,
        signer: from,
        chain: 'solana',
        network: 'mainnet',
      },
    );

    expect(result.instructions).toHaveLength(1);
    expect(result.instructions[0].programId.toBase58()).toBe(SystemProgram.programId.toBase58());
  });
});
