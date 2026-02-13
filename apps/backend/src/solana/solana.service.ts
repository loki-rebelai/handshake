import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@mikro-orm/nestjs';
import { CreateRequestContext } from '@mikro-orm/core';
import { EntityRepository, EntityManager } from '@mikro-orm/postgresql';
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, SystemProgram } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  createTransferInstruction,
  getAccount,
} from '@solana/spl-token';
import { HandshakeClient, generateNamedPoolId } from './handshake-client';
import { SilkysigClient } from './silkysig-client';
import { Token } from '../db/models/Token';
import { Pool } from '../db/models/Pool';
import * as idl from './handshake-idl.json';
import * as silkysigIdl from './silkysig-idl.json';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

@Injectable()
export class SolanaService implements OnModuleInit {
  private readonly logger = new Logger(SolanaService.name);

  private connection: Connection;
  private handshakeClient: HandshakeClient;
  private silkysigClient: SilkysigClient;
  private systemSigner: Keypair;

  // USDC faucet (transfers from system wallet balance)
  private usdcMintAddress: PublicKey | null = null;

  // Faucet rate limiting (in-memory)
  private faucetLastRequest = new Map<string, number>();
  private readonly FAUCET_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

  constructor(
    private readonly configService: ConfigService,
    private readonly em: EntityManager,
    @InjectRepository(Token) private readonly tokenRepo: EntityRepository<Token>,
    @InjectRepository(Pool) private readonly poolRepo: EntityRepository<Pool>,
  ) {}

  async onModuleInit() {
    const rpcUrl = this.configService.get<string>('RPC_URL', 'https://api.devnet.solana.com');
    this.connection = new Connection(rpcUrl, 'confirmed');

    // Load system signer from keypair file (like Solana CLI convention)
    const signerPath = this.configService.get<string>('SYSTEM_SIGNER_PRIVATE_KEY')
      || path.join(os.homedir(), '.config', 'solana', 'id.json');
    try {
      const keyData = JSON.parse(fs.readFileSync(signerPath, 'utf-8'));
      this.systemSigner = Keypair.fromSecretKey(Uint8Array.from(keyData));
      this.logger.log(`System signer loaded from ${signerPath}: ${this.systemSigner.publicKey.toBase58()}`);
    } catch (e) {
      this.systemSigner = Keypair.generate();
      this.logger.warn(`Could not load keypair from ${signerPath}, using ephemeral keypair: ${this.systemSigner.publicKey.toBase58()}`);
    }

    // Initialize Anchor program
    const programId = this.configService.get<string>(
      'HANDSHAKE_PROGRAM_ID',
      'HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ',
    );

    const wallet = new Wallet(this.systemSigner);
    const provider = new AnchorProvider(this.connection, wallet, {
      commitment: 'confirmed',
    });
    const program = new Program(idl as any, provider);

    this.handshakeClient = new HandshakeClient(program);
    this.logger.log(`Solana connected to ${rpcUrl}, program ${programId}`);

    // Initialize Silkysig program
    const silkysigProgramId = this.configService.get<string>(
      'SILKYSIG_PROGRAM_ID',
      'SiLKos3MCFggwLsjSeuRiCdcs2MLoJNwq59XwTvEwcS',
    );
    const silkysigProgram = new Program(silkysigIdl as any, provider);
    this.silkysigClient = new SilkysigClient(silkysigProgram);
    this.logger.log(`Silkysig program ${silkysigProgramId}`);

    // Load USDC mint config (transfers from system wallet balance)
    const usdcMint = this.configService.get<string>('USDC_MINT_ADDRESS');
    if (usdcMint) {
      this.usdcMintAddress = new PublicKey(usdcMint);
      this.logger.log(`USDC faucet configured: mint ${usdcMint} (transfers from system wallet)`);
    }

    // Sync token and pool to database from on-chain state
    await this.syncTokenAndPool();
  }

  @CreateRequestContext()
  private async syncTokenAndPool() {
    const usdcMintAddr = this.configService.get<string>('USDC_MINT_ADDRESS');
    const poolName = this.configService.get<string>('HANDSHAKE_POOL_NAME');

    if (!usdcMintAddr) {
      this.logger.warn('USDC_MINT_ADDRESS not set, skipping token/pool sync');
      return;
    }

    // Ensure Token record exists
    let token = await this.tokenRepo.findOne({ mint: usdcMintAddr });
    if (!token) {
      token = new Token(usdcMintAddr, 'USD Coin', 'USDC', 6);
      await this.em.persistAndFlush(token);
      this.logger.log(`Token synced to DB: USDC (${usdcMintAddr})`);
    } else {
      this.logger.log(`Token already in DB: USDC (${usdcMintAddr})`);
    }

    if (!poolName) {
      this.logger.warn('HANDSHAKE_POOL_NAME not set, skipping pool sync');
      return;
    }

    // Derive pool PDA and sync from chain
    const poolId = generateNamedPoolId(poolName);
    const [poolPda] = this.handshakeClient.findPoolPda(poolId);
    const poolPdaStr = poolPda.toBase58();

    let pool = await this.poolRepo.findOne({ poolPda: poolPdaStr });
    if (!pool) {
      // Fetch from chain to verify it exists
      const onChain = await this.handshakeClient.fetchPool(poolPda);
      if (!onChain) {
        this.logger.warn(`Pool "${poolName}" (${poolPdaStr}) not found on-chain. Run scripts/setup-devnet.ts first.`);
        return;
      }

      pool = new Pool(
        poolId.toBase58(),
        poolPdaStr,
        onChain.operator.toBase58(),
        token,
        onChain.transferFeeBps,
        { isPaused: onChain.isPaused },
      );
      await this.em.persistAndFlush(pool);
      this.logger.log(`Pool synced to DB: "${poolName}" (${poolPdaStr})`);
    } else {
      this.logger.log(`Pool already in DB: "${poolName}" (${poolPdaStr})`);
    }
  }

  getConnection(): Connection {
    return this.connection;
  }

  getHandshakeClient(): HandshakeClient {
    return this.handshakeClient;
  }

  getSilkysigClient(): SilkysigClient {
    return this.silkysigClient;
  }

  getSystemSigner(): Keypair {
    return this.systemSigner;
  }

  getUsdcMintAddress(): PublicKey | null {
    return this.usdcMintAddress;
  }

  // --- Faucet ---

  private checkRateLimit(key: string) {
    const lastRequest = this.faucetLastRequest.get(key);
    if (lastRequest && Date.now() - lastRequest < this.FAUCET_COOLDOWN_MS) {
      const waitSec = Math.ceil((this.FAUCET_COOLDOWN_MS - (Date.now() - lastRequest)) / 1000);
      throw new Error(`RATE_LIMITED: Try again in ${waitSec} seconds`);
    }
  }

  async transferSol(wallet: PublicKey): Promise<{ sol: { amount: number; txid: string } }> {
    const walletStr = `sol:${wallet.toBase58()}`;
    this.checkRateLimit(walletStr);

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: this.systemSigner.publicKey,
        toPubkey: wallet,
        lamports: 0.1 * LAMPORTS_PER_SOL,
      }),
    );

    this.logger.debug(`[RPC] getLatestBlockhash for transferSol to ${wallet.toBase58()}`);
    const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = this.systemSigner.publicKey;
    tx.sign(this.systemSigner);

    this.logger.debug(`[RPC] sendRawTransaction for transferSol`);
    const txid = await this.connection.sendRawTransaction(tx.serialize());
    this.logger.debug(`[RPC] confirmTransaction for transferSol: ${txid}`);
    await this.connection.confirmTransaction(txid, 'confirmed');

    this.faucetLastRequest.set(walletStr, Date.now());
    return { sol: { amount: 0.1, txid } };
  }

  async transferUsdc(wallet: PublicKey, amount: number = 100): Promise<{ usdc: { amount: number; txid: string } }> {
    if (!this.usdcMintAddress) {
      throw new Error('USDC faucet not configured. Set USDC_MINT_ADDRESS in .env.');
    }

    const walletStr = `usdc:${wallet.toBase58()}`;
    this.checkRateLimit(walletStr);

    const sourceAta = getAssociatedTokenAddressSync(this.usdcMintAddress, this.systemSigner.publicKey, true);
    const destAta = getAssociatedTokenAddressSync(this.usdcMintAddress, wallet, true);

    const tx = new Transaction();

    // Create destination ATA if it doesn't exist
    try {
      this.logger.debug(`[RPC] getAccount for ATA ${destAta.toBase58()}`);
      await getAccount(this.connection, destAta);
    } catch {
      tx.add(
        createAssociatedTokenAccountInstruction(
          this.systemSigner.publicKey,
          destAta,
          wallet,
          this.usdcMintAddress,
        ),
      );
    }

    // Transfer tokens from system wallet (amount * 10^6 for 6 decimals)
    const rawAmount = amount * 1e6;
    tx.add(
      createTransferInstruction(
        sourceAta,
        destAta,
        this.systemSigner.publicKey,
        rawAmount,
      ),
    );

    this.logger.debug(`[RPC] getLatestBlockhash for transferUsdc to ${wallet.toBase58()}`);
    const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = this.systemSigner.publicKey;
    tx.sign(this.systemSigner);

    this.logger.debug(`[RPC] sendRawTransaction for transferUsdc`);
    const txid = await this.connection.sendRawTransaction(tx.serialize());
    this.logger.debug(`[RPC] confirmTransaction for transferUsdc: ${txid}`);
    await this.connection.confirmTransaction(txid, 'confirmed');

    this.faucetLastRequest.set(walletStr, Date.now());
    return { usdc: { amount, txid } };
  }

  async fundWallet(
    wallet: PublicKey,
    opts: { sol?: boolean; usdc?: boolean } = { sol: true, usdc: true },
  ): Promise<{ sol?: { amount: number; txid: string }; usdc?: { amount: number; txid: string } }> {
    const walletStr = wallet.toBase58();
    this.checkRateLimit(`fund:${walletStr}`);

    if (opts.usdc && !this.usdcMintAddress) {
      throw new Error('USDC faucet not configured. Set USDC_MINT_ADDRESS in .env.');
    }

    const tx = new Transaction();

    // SOL transfer instruction
    if (opts.sol) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: this.systemSigner.publicKey,
          toPubkey: wallet,
          lamports: 0.1 * LAMPORTS_PER_SOL,
        }),
      );
    }

    // USDC ATA creation + transfer instructions
    if (opts.usdc) {
      const sourceAta = getAssociatedTokenAddressSync(this.usdcMintAddress!, this.systemSigner.publicKey, true);
      const destAta = getAssociatedTokenAddressSync(this.usdcMintAddress!, wallet, true);

      try {
        this.logger.debug(`[RPC] getAccount for ATA ${destAta.toBase58()}`);
        await getAccount(this.connection, destAta);
      } catch {
        tx.add(
          createAssociatedTokenAccountInstruction(
            this.systemSigner.publicKey,
            destAta,
            wallet,
            this.usdcMintAddress!,
          ),
        );
      }

      const rawAmount = 100 * 1e6;
      tx.add(
        createTransferInstruction(
          sourceAta,
          destAta,
          this.systemSigner.publicKey,
          rawAmount,
        ),
      );
    }

    this.logger.debug(`[RPC] getLatestBlockhash for fundWallet (sol=${opts.sol}, usdc=${opts.usdc})`);
    const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = this.systemSigner.publicKey;
    tx.sign(this.systemSigner);

    this.logger.debug(`[RPC] sendRawTransaction for fundWallet`);
    const txid = await this.connection.sendRawTransaction(tx.serialize());
    this.logger.debug(`[RPC] confirmTransaction for fundWallet: ${txid}`);
    await this.connection.confirmTransaction(txid, 'confirmed');

    this.faucetLastRequest.set(`fund:${walletStr}`, Date.now());

    const result: { sol?: { amount: number; txid: string }; usdc?: { amount: number; txid: string } } = {};
    if (opts.sol) result.sol = { amount: 0.1, txid };
    if (opts.usdc) result.usdc = { amount: 100, txid };
    return result;
  }
}
