import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import { HandshakeClient } from './handshake-client';
import * as idl from './handshake-idl.json';

@Injectable()
export class SolanaService implements OnModuleInit {
  private readonly logger = new Logger(SolanaService.name);

  private connection: Connection;
  private handshakeClient: HandshakeClient;
  private systemSigner: Keypair;

  // Faucet rate limiting (in-memory)
  private faucetLastRequest = new Map<string, number>();
  private readonly FAUCET_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const rpcUrl = this.configService.get<string>('RPC_URL', 'https://api.devnet.solana.com');
    this.connection = new Connection(rpcUrl, 'confirmed');

    // Load system signer
    const signerKey = this.configService.get<string>('SYSTEM_SIGNER_PRIVATE_KEY');
    if (signerKey) {
      this.systemSigner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(signerKey)));
    } else {
      this.systemSigner = Keypair.generate();
      this.logger.warn('No SYSTEM_SIGNER_PRIVATE_KEY configured, using ephemeral keypair');
    }

    // Initialize Anchor program
    const programId = this.configService.get<string>(
      'HANDSHAKE_PROGRAM_ID',
      'HZ8paEkYZ2hKBwHoVk23doSLEad9K5duASRTGaYogmfg',
    );

    const wallet = new Wallet(this.systemSigner);
    const provider = new AnchorProvider(this.connection, wallet, {
      commitment: 'confirmed',
    });
    const program = new Program(idl as any, provider);

    this.handshakeClient = new HandshakeClient(program);
    this.logger.log(`Solana connected to ${rpcUrl}, program ${programId}`);
  }

  getConnection(): Connection {
    return this.connection;
  }

  getHandshakeClient(): HandshakeClient {
    return this.handshakeClient;
  }

  getSystemSigner(): Keypair {
    return this.systemSigner;
  }

  // --- Faucet ---

  async requestAirdrop(wallet: PublicKey): Promise<{ sol: { amount: number; txid: string } }> {
    const walletStr = wallet.toBase58();

    // Rate limit check
    const lastRequest = this.faucetLastRequest.get(walletStr);
    if (lastRequest && Date.now() - lastRequest < this.FAUCET_COOLDOWN_MS) {
      const waitSec = Math.ceil((this.FAUCET_COOLDOWN_MS - (Date.now() - lastRequest)) / 1000);
      throw new Error(`RATE_LIMITED: Try again in ${waitSec} seconds`);
    }

    const txid = await this.connection.requestAirdrop(wallet, 1 * LAMPORTS_PER_SOL);
    await this.connection.confirmTransaction(txid, 'confirmed');

    this.faucetLastRequest.set(walletStr, Date.now());

    return { sol: { amount: 1.0, txid } };
  }
}
