import { Injectable, Logger } from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { SolanaService } from '../../solana/solana.service';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(private readonly solanaService: SolanaService) {}

  async getAccountsByOperator(operatorPubkey: string) {
    this.logger.log(`getAccountsByOperator: ${operatorPubkey}`);
    const client = this.solanaService.getSilkysigClient();
    return client.findAccountsByOperator(new PublicKey(operatorPubkey));
  }

  async getAccount(pda: string) {
    this.logger.log(`getAccount: ${pda}`);
    const client = this.solanaService.getSilkysigClient();
    const connection = this.solanaService.getConnection();
    const pdaKey = new PublicKey(pda);

    const account = await client.fetchAccount(pdaKey);
    if (!account) return null;

    const { getAssociatedTokenAddressSync } = await import('@solana/spl-token');
    const ata = getAssociatedTokenAddressSync(account.mint, pdaKey, true);

    let balance = 0;
    let mintDecimals = 0;
    try {
      const tokenBalance = await connection.getTokenAccountBalance(ata);
      balance = Number(tokenBalance.value.amount);
      mintDecimals = tokenBalance.value.decimals;
    } catch {
      // ATA may not exist yet
    }

    if (account.driftUser) {
      balance = Number(account.principalBalance);
    }

    return { pda, account, balance, mintDecimals };
  }

  async buildCreateAccountTx(params: {
    owner: string;
    mint: string;
    operator?: string;
    perTxLimit?: number;
  }) {
    this.logger.log(`buildCreateAccountTx: owner=${params.owner}, operator=${params.operator || 'none'}, limit=${params.perTxLimit ?? 'none'}`);
    const client = this.solanaService.getSilkysigClient();
    const owner = new PublicKey(params.owner);
    const mint = new PublicKey(params.mint);
    const operator = params.operator ? new PublicKey(params.operator) : undefined;
    const perTxLimit = params.perTxLimit != null ? new BN(params.perTxLimit) : undefined;

    return client.buildCreateAccountTx(owner, mint, operator, perTxLimit);
  }

  async buildDepositTx(params: {
    depositor: string;
    accountPda: string;
    amount: number;
  }) {
    this.logger.log(`buildDepositTx: depositor=${params.depositor}, account=${params.accountPda}, amount=${params.amount}`);
    const client = this.solanaService.getSilkysigClient();
    return client.buildDepositTx(
      new PublicKey(params.depositor),
      new PublicKey(params.accountPda),
      new BN(params.amount),
    );
  }

  async buildTransferFromAccountTx(params: {
    signer: string;
    accountPda: string;
    recipient: string;
    amount: number;
  }) {
    this.logger.log(`buildTransferFromAccountTx: signer=${params.signer}, account=${params.accountPda}, recipient=${params.recipient}, amount=${params.amount}`);
    const client = this.solanaService.getSilkysigClient();
    return client.buildTransferFromAccountTx(
      new PublicKey(params.signer),
      new PublicKey(params.accountPda),
      new PublicKey(params.recipient),
      new BN(params.amount),
    );
  }

  async buildTogglePauseTx(params: { owner: string; accountPda: string }) {
    const client = this.solanaService.getSilkysigClient();
    return client.buildTogglePauseTx(
      new PublicKey(params.owner),
      new PublicKey(params.accountPda),
    );
  }

  async buildAddOperatorTx(params: {
    owner: string;
    accountPda: string;
    operator: string;
    perTxLimit?: number;
  }) {
    const client = this.solanaService.getSilkysigClient();
    return client.buildAddOperatorTx(
      new PublicKey(params.owner),
      new PublicKey(params.accountPda),
      new PublicKey(params.operator),
      params.perTxLimit != null ? new BN(params.perTxLimit) : undefined,
    );
  }

  async buildRemoveOperatorTx(params: {
    owner: string;
    accountPda: string;
    operator: string;
  }) {
    const client = this.solanaService.getSilkysigClient();
    return client.buildRemoveOperatorTx(
      new PublicKey(params.owner),
      new PublicKey(params.accountPda),
      new PublicKey(params.operator),
    );
  }

  async buildCloseAccountTx(params: { owner: string; accountPda: string }) {
    const client = this.solanaService.getSilkysigClient();
    return client.buildCloseAccountTx(
      new PublicKey(params.owner),
      new PublicKey(params.accountPda),
    );
  }
}
