import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityManager, EntityRepository } from '@mikro-orm/postgresql';
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { SolanaService } from '../../solana/solana.service';
import { Transfer, TransferStatus } from '../../db/models/Transfer';
import { Pool } from '../../db/models/Pool';
import { Token } from '../../db/models/Token';

export interface CreateTransferParams {
  sender: string;
  recipient: string;
  amount: number;
  mint?: string;
  poolPda?: string;
  token?: string;
  memo?: string;
  claimableAfter?: number;
  claimableUntil?: number;
}

export interface ClaimTransferParams {
  transferPda: string;
  claimer: string;
}

export interface CancelTransferParams {
  transferPda: string;
  canceller: string;
}

@Injectable()
export class TxService {
  private readonly logger = new Logger(TxService.name);

  constructor(
    private readonly solanaService: SolanaService,
    private readonly em: EntityManager,
    @InjectRepository(Transfer)
    private readonly transferRepo: EntityRepository<Transfer>,
    @InjectRepository(Pool)
    private readonly poolRepo: EntityRepository<Pool>,
    @InjectRepository(Token)
    private readonly tokenRepo: EntityRepository<Token>,
  ) {}

  async buildCreateTransfer(params: CreateTransferParams) {
    this.logger.log(`buildCreateTransfer: ${params.sender} -> ${params.recipient}, amount=${params.amount} ${params.token || params.mint || 'default'}`);
    const client = this.solanaService.getHandshakeClient();
    const connection = this.solanaService.getConnection();

    const sender = new PublicKey(params.sender);
    const recipient = new PublicKey(params.recipient);

    // Resolve pool: explicit poolPda > token symbol > mint lookup
    let poolPda: PublicKey;
    if (params.poolPda) {
      poolPda = new PublicKey(params.poolPda);
    } else {
      const pool = await this.resolvePool(params.token, params.mint);
      poolPda = new PublicKey(pool.poolPda);
    }

    // Fetch pool to get token decimals
    const poolAccount = await client.fetchPool(poolPda);
    if (!poolAccount) throw new Error('POOL_NOT_FOUND');

    // Get or create token
    const token = await this.getOrCreateToken(poolAccount.mint.toBase58());

    const amountRaw = new BN(params.amount * 10 ** token.decimals);
    const nonce = new BN(Date.now());

    const { transferPda, ix } = await client.getCreateTransferIx(
      sender,
      recipient,
      poolPda,
      nonce,
      amountRaw,
      params.memo || '',
      params.claimableAfter || 0,
      params.claimableUntil || 0,
    );

    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.feePayer = sender;
    tx.add(ix);

    const serialized = tx.serialize({ requireAllSignatures: false }).toString('base64');

    // Persist transfer to DB as PENDING
    let pool = await this.poolRepo.findOne({ poolPda: poolPda.toBase58() }, { populate: ['token'] });
    if (!pool) {
      pool = await this.ensurePool(poolPda.toBase58());
    }

    const transfer = new Transfer(
      transferPda.toBase58(),
      params.sender,
      params.recipient,
      params.amount.toString(),
      amountRaw.toString(),
      token,
      pool,
      {
        status: TransferStatus.PENDING,
        memo: params.memo,
        claimableAfter: params.claimableAfter ? new Date(params.claimableAfter * 1000) : undefined,
        claimableUntil: params.claimableUntil ? new Date(params.claimableUntil * 1000) : undefined,
      },
    );
    await this.em.persistAndFlush(transfer);

    return {
      transaction: serialized,
      transferPda: transferPda.toBase58(),
      nonce: nonce.toString(),
      message: 'Sign and submit via POST /api/tx/submit',
    };
  }

  async buildClaimTransfer(params: ClaimTransferParams) {
    this.logger.log(`buildClaimTransfer: claimer=${params.claimer}, pda=${params.transferPda}`);
    const client = this.solanaService.getHandshakeClient();
    const connection = this.solanaService.getConnection();

    const recipient = new PublicKey(params.claimer);
    const transferPda = new PublicKey(params.transferPda);

    let ix;
    try {
      ({ ix } = await client.getClaimTransferIx(recipient, transferPda));
    } catch (e) {
      if (e.message?.includes('Transfer account not found')) {
        throw new NotFoundException({ ok: false, error: 'TRANSFER_NOT_FOUND', message: e.message });
      }
      throw e;
    }

    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.feePayer = recipient;
    tx.add(ix);

    const serialized = tx.serialize({ requireAllSignatures: false }).toString('base64');

    return {
      transaction: serialized,
      message: 'Sign and submit via POST /api/tx/submit',
    };
  }

  async buildCancelTransfer(params: CancelTransferParams) {
    this.logger.log(`buildCancelTransfer: canceller=${params.canceller}, pda=${params.transferPda}`);
    const client = this.solanaService.getHandshakeClient();
    const connection = this.solanaService.getConnection();

    const sender = new PublicKey(params.canceller);
    const transferPda = new PublicKey(params.transferPda);

    let ix;
    try {
      ({ ix } = await client.getCancelTransferIx(sender, transferPda));
    } catch (e) {
      if (e.message?.includes('Transfer account not found')) {
        throw new NotFoundException({ ok: false, error: 'TRANSFER_NOT_FOUND', message: e.message });
      }
      throw e;
    }

    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.feePayer = sender;
    tx.add(ix);

    const serialized = tx.serialize({ requireAllSignatures: false }).toString('base64');

    return {
      transaction: serialized,
      message: 'Sign and submit via POST /api/tx/submit',
    };
  }

  async submitSignedTx(signedTxBase64: string) {
    this.logger.log(`submitSignedTx: ${signedTxBase64.length} bytes`);
    const connection = this.solanaService.getConnection();
    const client = this.solanaService.getHandshakeClient();

    const txBuffer = Buffer.from(signedTxBase64, 'base64');

    // Try versioned first, fall back to legacy
    let txid: string;
    try {
      const vtx = VersionedTransaction.deserialize(txBuffer);
      txid = await connection.sendTransaction(vtx);
    } catch {
      const tx = Transaction.from(txBuffer);
      txid = await connection.sendRawTransaction(tx.serialize());
    }

    await connection.confirmTransaction(txid, 'confirmed');
    this.logger.log(`submitSignedTx confirmed: ${txid}`);

    // Index the transfer if this was a transfer-related tx
    await this.indexFromTx(txid);

    return { txid };
  }

  private async indexFromTx(txid: string) {
    try {
      const connection = this.solanaService.getConnection();
      const client = this.solanaService.getHandshakeClient();
      const programId = this.solanaService.getHandshakeClient()['program'].programId;

      const txInfo = await connection.getTransaction(txid, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });

      if (!txInfo) return;

      // Look for program accounts in the transaction to find transfer PDAs
      const accountKeys = txInfo.transaction.message.staticAccountKeys
        ? txInfo.transaction.message.staticAccountKeys
        : (txInfo.transaction.message as any).accountKeys;

      if (!accountKeys) return;

      for (const key of accountKeys) {
        const pubkey = key instanceof PublicKey ? key : new PublicKey(key);
        try {
          const transferAccount = await client.fetchTransfer(pubkey);
          if (!transferAccount) continue;

          // Found a transfer account — index it
          await this.upsertTransfer(pubkey.toBase58(), transferAccount, txid);
        } catch {
          // Not a transfer account, skip
        }
      }
    } catch (e) {
      this.logger.warn(`Failed to index tx ${txid}: ${e.message}`);
    }
  }

  private async upsertTransfer(pda: string, onChain: any, txid: string) {
    const existing = await this.transferRepo.findOne({ transferPda: pda });

    const statusMap: Record<string, TransferStatus> = {
      active: TransferStatus.ACTIVE,
      claimed: TransferStatus.CLAIMED,
      cancelled: TransferStatus.CANCELLED,
      rejected: TransferStatus.REJECTED,
      expired: TransferStatus.EXPIRED,
      declined: TransferStatus.DECLINED,
    };

    const statusKey = Object.keys(onChain.status)[0];
    const status = statusMap[statusKey] || TransferStatus.ACTIVE;

    if (existing) {
      existing.status = status;
      if (!existing.createTxid) existing.createTxid = txid;
      if (status === TransferStatus.CLAIMED) existing.claimTxid = txid;
      if (status === TransferStatus.CANCELLED) existing.cancelTxid = txid;
      await this.em.flush();
      return existing;
    }

    // New transfer — need pool and token
    const poolPda = onChain.pool.toBase58();
    let pool = await this.poolRepo.findOne({ poolPda }, { populate: ['token'] });
    if (!pool) {
      pool = await this.ensurePool(poolPda);
    }

    const token = pool.token;

    const transfer = new Transfer(
      pda,
      onChain.sender.toBase58(),
      onChain.recipient.toBase58(),
      (onChain.amount as BN).toString(),
      (onChain.amount as BN).toString(),
      token,
      pool,
      {
        status,
        memo: this.decodeMemo(onChain.memo),
        createTxid: txid,
        claimableAfter: this.bnToDate(onChain.claimableAfter),
        claimableUntil: this.bnToDate(onChain.claimableUntil),
      },
    );

    await this.em.persistAndFlush(transfer);
    return transfer;
  }

  private async ensurePool(poolPda: string): Promise<Pool> {
    const client = this.solanaService.getHandshakeClient();
    const onChain = await client.fetchPool(new PublicKey(poolPda));
    if (!onChain) throw new Error(`Pool ${poolPda} not found on-chain`);

    const token = await this.getOrCreateToken(onChain.mint.toBase58());

    const pool = new Pool(
      onChain.poolId.toBase58(),
      poolPda,
      onChain.operator.toBase58(),
      token,
      onChain.transferFeeBps,
      { isPaused: onChain.isPaused },
    );

    await this.em.persistAndFlush(pool);
    return pool;
  }

  private async getOrCreateToken(mint: string): Promise<Token> {
    let token = await this.tokenRepo.findOne({ mint });
    if (token) return token;

    // For now, create a placeholder. In the future, fetch metadata from chain.
    token = new Token(mint, 'Unknown', 'UNK', 6);

    await this.em.persistAndFlush(token);
    return token;
  }

  private async resolvePool(tokenSymbol?: string, mint?: string): Promise<Pool> {
    if (mint) {
      const token = await this.tokenRepo.findOne({ mint });
      if (!token) throw new Error('TOKEN_NOT_FOUND');
      const pool = await this.poolRepo.findOne({ token }, { populate: ['token'] });
      if (!pool) throw new Error('POOL_NOT_FOUND');
      return pool;
    }
    if (tokenSymbol) {
      const token = await this.tokenRepo.findOne({ symbol: { $ilike: tokenSymbol } });
      if (!token) throw new Error('TOKEN_NOT_FOUND');
      const pool = await this.poolRepo.findOne({ token }, { populate: ['token'] });
      if (!pool) throw new Error('POOL_NOT_FOUND');
      return pool;
    }
    // Default: find first active pool
    const pool = await this.poolRepo.findOne({ isPaused: false }, { populate: ['token'] });
    if (!pool) throw new Error('NO_ACTIVE_POOL');
    return pool;
  }

  private decodeMemo(memo: number[]): string {
    const bytes = memo.filter((b) => b !== 0);
    return Buffer.from(bytes).toString('utf-8');
  }

  private bnToDate(bn: BN): Date | undefined {
    const val = bn.toNumber();
    if (val === 0) return undefined;
    return new Date(val * 1000);
  }
}
