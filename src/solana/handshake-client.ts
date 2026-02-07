import { Program, web3, utils, BN } from '@coral-xyz/anchor';
import { Connection, PublicKey, SystemProgram } from '@solana/web3.js';
import { Idl } from '@coral-xyz/anchor';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';

// PDA seeds — must match the Rust program constants
export const POOL_SEED = 'pool';
export const SENDER_SEED = 'sender';
export const RECIPIENT_SEED = 'recipient';
export const NONCE_SEED = 'nonce';

// On-chain account interfaces (matching Rust structs)
export interface PoolAccount {
  version: number;
  bump: number;
  poolId: PublicKey;
  operator: PublicKey;
  mint: PublicKey;
  transferFeeBps: number;
  totalDeposits: BN;
  totalWithdrawals: BN;
  totalEscrowed: BN;
  totalTransfersCreated: BN;
  totalTransfersResolved: BN;
  collectedFees: BN;
  isPaused: boolean;
}

export interface TransferAccount {
  version: number;
  bump: number;
  nonce: BN;
  sender: PublicKey;
  recipient: PublicKey;
  pool: PublicKey;
  amount: BN;
  createdAt: BN;
  claimableAfter: BN;
  claimableUntil: BN;
  status: any;
  releaseConditions: any;
  memo: number[];
  complianceHash: number[] | null;
}

export class HandshakeClient {
  private program: Program<Idl>;
  private connection: Connection;

  constructor(program: any) {
    this.program = program;
    this.connection = program.provider.connection;
  }

  findPoolPda = (poolId: PublicKey): [PublicKey, number] => {
    return web3.PublicKey.findProgramAddressSync(
      [Buffer.from(utils.bytes.utf8.encode(POOL_SEED)), poolId.toBuffer()],
      this.program.programId,
    );
  };

  findTransferPda = (
    sender: PublicKey,
    recipient: PublicKey,
    nonce: BN,
  ): [PublicKey, number] => {
    return web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from(utils.bytes.utf8.encode(SENDER_SEED)),
        sender.toBuffer(),
        Buffer.from(utils.bytes.utf8.encode(RECIPIENT_SEED)),
        recipient.toBuffer(),
        Buffer.from(utils.bytes.utf8.encode(NONCE_SEED)),
        nonce.toArrayLike(Buffer, 'le', 8),
      ],
      this.program.programId,
    );
  };

  getTokenAccount = (
    mint: PublicKey,
    owner: PublicKey,
    isToken2022: boolean = false,
  ): PublicKey => {
    return getAssociatedTokenAddressSync(
      mint,
      owner,
      true,
      isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
    );
  };

  async getCreateTransferIx(
    sender: PublicKey,
    recipient: PublicKey,
    poolPda: PublicKey,
    nonce: BN,
    amount: BN,
    memo: string,
    claimableAfter: number = 0,
    claimableUntil: number = 0,
    isToken2022: boolean = false,
  ) {
    const [transferPda, transferBump] = this.findTransferPda(sender, recipient, nonce);
    const poolAccount = (await (this.program.account as any).pool.fetch(poolPda)) as PoolAccount;
    const mint = poolAccount.mint;

    const tokenProgram = isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const poolTokenAccount = this.getTokenAccount(mint, poolPda, isToken2022);
    const senderTokenAccount = this.getTokenAccount(mint, sender, isToken2022);

    const accounts = {
      sender,
      pool: poolPda,
      mint,
      poolTokenAccount,
      senderTokenAccount,
      transfer: transferPda,
      tokenProgram,
      systemProgram: SystemProgram.programId,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    };

    const ix = await (this.program.methods as any)
      .createTransfer(recipient, nonce, amount, memo, new BN(claimableAfter), new BN(claimableUntil))
      .accounts(accounts)
      .instruction();

    return { transferPda, transferBump, ix };
  }

  async getClaimTransferIx(
    recipient: PublicKey,
    transferPda: PublicKey,
    isToken2022: boolean = false,
  ) {
    const transferAccount = (await (this.program.account as any).secureTransfer.fetch(transferPda)) as TransferAccount;
    const poolPda = transferAccount.pool;
    const poolAccount = (await (this.program.account as any).pool.fetch(poolPda)) as PoolAccount;
    const mint = poolAccount.mint;
    const sender = transferAccount.sender;

    const tokenProgram = isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const poolTokenAccount = this.getTokenAccount(mint, poolPda, isToken2022);
    const recipientTokenAccount = this.getTokenAccount(mint, recipient, isToken2022);

    const accounts = {
      recipient,
      pool: poolPda,
      mint,
      poolTokenAccount,
      recipientTokenAccount,
      transfer: transferPda,
      sender,
      tokenProgram,
    };

    const ix = await (this.program.methods as any)
      .claimTransfer()
      .accounts(accounts)
      .instruction();

    return { ix };
  }

  async getCancelTransferIx(
    sender: PublicKey,
    transferPda: PublicKey,
    isToken2022: boolean = false,
  ) {
    const transferAccount = (await (this.program.account as any).secureTransfer.fetch(transferPda)) as TransferAccount;
    const poolPda = transferAccount.pool;
    const poolAccount = (await (this.program.account as any).pool.fetch(poolPda)) as PoolAccount;
    const mint = poolAccount.mint;

    const tokenProgram = isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const poolTokenAccount = this.getTokenAccount(mint, poolPda, isToken2022);
    const senderTokenAccount = this.getTokenAccount(mint, sender, isToken2022);

    const accounts = {
      sender,
      pool: poolPda,
      mint,
      poolTokenAccount,
      senderTokenAccount,
      transfer: transferPda,
      tokenProgram,
    };

    const ix = await (this.program.methods as any)
      .cancelTransfer()
      .accounts(accounts)
      .instruction();

    return { ix };
  }

  async fetchPool(poolPda: PublicKey): Promise<PoolAccount | null> {
    try {
      return (await (this.program.account as any).pool.fetch(poolPda)) as PoolAccount;
    } catch {
      return null;
    }
  }

  async fetchTransfer(transferPda: PublicKey): Promise<TransferAccount | null> {
    try {
      return (await (this.program.account as any).secureTransfer.fetch(transferPda)) as TransferAccount;
    } catch {
      return null;
    }
  }
}
