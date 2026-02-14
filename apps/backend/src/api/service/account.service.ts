import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityManager, EntityRepository } from '@mikro-orm/postgresql';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { SolanaService } from '../../solana/solana.service';
import { SilkAccount, SilkAccountStatus } from '../../db/models/SilkAccount';
import { SilkAccountOperator } from '../../db/models/SilkAccountOperator';
import { SilkAccountEvent, SilkAccountEventType } from '../../db/models/SilkAccountEvent';

const SILKYSIG_INSTRUCTION_MAP: Record<string, SilkAccountEventType> = {
  CreateAccount: SilkAccountEventType.ACCOUNT_CREATED,
  CloseAccount: SilkAccountEventType.ACCOUNT_CLOSED,
  Deposit: SilkAccountEventType.DEPOSIT,
  TransferFromAccount: SilkAccountEventType.TRANSFER,
  AddOperator: SilkAccountEventType.OPERATOR_ADDED,
  RemoveOperator: SilkAccountEventType.OPERATOR_REMOVED,
  TogglePause: SilkAccountEventType.PAUSED, // resolved to PAUSED/UNPAUSED later
};

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly solanaService: SolanaService,
    private readonly em: EntityManager,
    @InjectRepository(SilkAccount)
    private readonly silkAccountRepo: EntityRepository<SilkAccount>,
    @InjectRepository(SilkAccountOperator)
    private readonly operatorRepo: EntityRepository<SilkAccountOperator>,
    @InjectRepository(SilkAccountEvent)
    private readonly eventRepo: EntityRepository<SilkAccountEvent>,
  ) {}

  // ─── On-chain reads & tx building ───────────────────────────────────────────

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

  // ─── Indexing ───────────────────────────────────────────────────────────────

  async indexSilkysigTx(txid: string, txInfo: any) {
    try {
      const eventTypes = this.parseSilkysigEvents(txInfo.meta?.logMessages);
      if (eventTypes.length === 0) return;

      const client = this.solanaService.getSilkysigClient();
      const accountKeys = txInfo.transaction.message.staticAccountKeys
        ? txInfo.transaction.message.staticAccountKeys
        : (txInfo.transaction.message as any).accountKeys;
      if (!accountKeys) return;

      const actor = (accountKeys[0] instanceof PublicKey
        ? accountKeys[0]
        : new PublicKey(accountKeys[0])
      ).toBase58();

      // Find the SilkAccount PDA — try fetching each account key from on-chain
      let silkAccountPda: string | null = null;
      let onChainAccount: any = null;

      for (const key of accountKeys) {
        const pubkey = key instanceof PublicKey ? key : new PublicKey(key);
        try {
          const fetched = await client.fetchAccount(pubkey);
          if (fetched) {
            silkAccountPda = pubkey.toBase58();
            onChainAccount = fetched;
            break;
          }
        } catch {
          // Not a SilkAccount, skip
        }
      }

      // For ACCOUNT_CLOSED the on-chain account is gone — find it in the DB
      const isClosed = eventTypes.includes(SilkAccountEventType.ACCOUNT_CLOSED);
      if (!silkAccountPda && isClosed) {
        for (const key of accountKeys) {
          const pubkey = (key instanceof PublicKey ? key : new PublicKey(key)).toBase58();
          const existing = await this.silkAccountRepo.findOne({ pda: pubkey });
          if (existing) {
            silkAccountPda = pubkey;
            break;
          }
        }
      }

      if (!silkAccountPda) return;

      // Upsert SilkAccount row
      let silkAccount = await this.silkAccountRepo.findOne({ pda: silkAccountPda });

      if (!silkAccount && onChainAccount) {
        silkAccount = new SilkAccount(
          silkAccountPda,
          onChainAccount.owner.toBase58(),
          onChainAccount.mint.toBase58(),
        );
        this.em.persist(silkAccount);
      }

      if (!silkAccount) return;

      // Process each event in the transaction (a create tx can have CreateAccount + AddOperator + InitDriftUser)
      for (const eventType of eventTypes) {
        let resolvedType = eventType;
        let eventData: Record<string, any> | undefined;

        switch (eventType) {
          case SilkAccountEventType.ACCOUNT_CREATED:
            silkAccount.status = SilkAccountStatus.ACTIVE;
            break;

          case SilkAccountEventType.ACCOUNT_CLOSED:
            silkAccount.status = SilkAccountStatus.CLOSED;
            // Delete all operator rows — they no longer exist on-chain
            const operators = await this.operatorRepo.find({ account: silkAccount });
            for (const op of operators) {
              this.em.remove(op);
            }
            break;

          case SilkAccountEventType.OPERATOR_ADDED:
            if (onChainAccount) {
              const newOp = this.findNewOperator(silkAccount, onChainAccount);
              if (newOp) {
                eventData = { operator: newOp.pubkey, perTxLimit: newOp.perTxLimit };
                const existing = await this.operatorRepo.findOne({
                  account: silkAccount,
                  operator: newOp.pubkey,
                });
                if (!existing) {
                  this.em.persist(new SilkAccountOperator(silkAccount, newOp.pubkey, newOp.perTxLimit));
                }
              }
            }
            break;

          case SilkAccountEventType.OPERATOR_REMOVED:
            if (onChainAccount) {
              const removed = await this.findRemovedOperator(silkAccount, onChainAccount);
              if (removed) {
                eventData = { operator: removed.operator };
                this.em.remove(removed);
              }
            }
            break;

          case SilkAccountEventType.TRANSFER: {
            const amounts = this.extractTokenBalanceChange(txInfo);
            if (amounts) {
              eventData = { recipient: amounts.counterparty, amount: amounts.amount };
            }
            break;
          }

          case SilkAccountEventType.DEPOSIT: {
            const amounts = this.extractTokenBalanceChange(txInfo);
            if (amounts) {
              eventData = { sender: amounts.counterparty, amount: amounts.amount };
            }
            break;
          }

          case SilkAccountEventType.PAUSED:
            // Resolve to PAUSED or UNPAUSED based on post-tx state
            if (onChainAccount) {
              resolvedType = onChainAccount.isPaused
                ? SilkAccountEventType.PAUSED
                : SilkAccountEventType.UNPAUSED;
            }
            break;
        }

        const event = new SilkAccountEvent(silkAccount, resolvedType, txid, actor, eventData);
        this.em.persist(event);
      }

      // Sync all operators from on-chain state for ACCOUNT_CREATED
      // (the create tx can include an AddOperator ix bundled in the same tx)
      if (eventTypes.includes(SilkAccountEventType.ACCOUNT_CREATED) && onChainAccount) {
        for (let i = 0; i < onChainAccount.operatorCount; i++) {
          const slot = onChainAccount.operators[i];
          const opPubkey = slot.pubkey.toBase58();
          const existing = await this.operatorRepo.findOne({
            account: silkAccount,
            operator: opPubkey,
          });
          if (!existing) {
            this.em.persist(new SilkAccountOperator(silkAccount, opPubkey, slot.perTxLimit.toString()));
          }
        }
      }

      await this.em.flush();
      this.logger.log(`Indexed Silkysig tx ${txid}: ${eventTypes.join(', ')} for ${silkAccountPda}`);
    } catch (e) {
      this.logger.warn(`Failed to index Silkysig tx ${txid}: ${e.message}`);
    }
  }

  // ─── Queries ────────────────────────────────────────────────────────────────

  async findAccountsByOwner(owner: string) {
    return this.silkAccountRepo.find({ owner }, { populate: ['operators'] });
  }

  async findEventsByAccount(pda: string, eventType?: SilkAccountEventType) {
    const account = await this.silkAccountRepo.findOne({ pda });
    if (!account) return [];

    const where: any = { account };
    if (eventType) where.eventType = eventType;

    return this.eventRepo.find(where, { orderBy: { createdAt: 'DESC' } });
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private parseSilkysigEvents(logs?: string[] | null): SilkAccountEventType[] {
    if (!logs) return [];

    const events: SilkAccountEventType[] = [];
    let inSilkysig = false;

    for (const log of logs) {
      // Anchor logs program invocation like: "Program SiLKos... invoke [1]"
      if (log.includes('SiLKos') && log.includes('invoke')) {
        inSilkysig = true;
      } else if (inSilkysig && log.includes('invoke')) {
        // Nested CPI — still in silkysig context
      } else if (log.includes('success') || (log.includes('invoke') && !log.includes('SiLKos'))) {
        inSilkysig = false;
      }

      if (!inSilkysig) continue;

      const match = log.match(/Instruction: (\w+)/);
      if (match && SILKYSIG_INSTRUCTION_MAP[match[1]]) {
        events.push(SILKYSIG_INSTRUCTION_MAP[match[1]]);
      }
    }

    return events;
  }

  private findNewOperator(
    silkAccount: SilkAccount,
    onChainAccount: any,
  ): { pubkey: string; perTxLimit: string } | null {
    // The most recently added operator is the last one in the on-chain slots
    if (onChainAccount.operatorCount === 0) return null;
    const lastSlot = onChainAccount.operators[onChainAccount.operatorCount - 1];
    return {
      pubkey: lastSlot.pubkey.toBase58(),
      perTxLimit: lastSlot.perTxLimit.toString(),
    };
  }

  private async findRemovedOperator(
    silkAccount: SilkAccount,
    onChainAccount: any,
  ): Promise<SilkAccountOperator | null> {
    // Compare DB operators against on-chain operators to find which was removed
    const dbOperators = await this.operatorRepo.find({ account: silkAccount });
    const onChainPubkeys = new Set<string>();
    for (let i = 0; i < onChainAccount.operatorCount; i++) {
      onChainPubkeys.add(onChainAccount.operators[i].pubkey.toBase58());
    }

    for (const dbOp of dbOperators) {
      if (!onChainPubkeys.has(dbOp.operator)) {
        return dbOp;
      }
    }

    return null;
  }

  private extractTokenBalanceChange(txInfo: any): { counterparty: string; amount: string } | null {
    const pre = txInfo.meta?.preTokenBalances;
    const post = txInfo.meta?.postTokenBalances;
    if (!pre || !post) return null;

    // Find accounts with balance changes, skip the SilkAccount's own ATA
    // The counterparty is the non-fee-payer account that had a balance change
    for (let i = 0; i < post.length; i++) {
      const postBal = post[i];
      const preBal = pre.find((p: any) => p.accountIndex === postBal.accountIndex);
      const preAmount = preBal ? BigInt(preBal.uiTokenAmount.amount) : 0n;
      const postAmount = BigInt(postBal.uiTokenAmount.amount);
      const diff = postAmount - preAmount;

      if (diff !== 0n) {
        const absDiff = diff > 0n ? diff : -diff;
        return {
          counterparty: postBal.owner || '',
          amount: absDiff.toString(),
        };
      }
    }

    return null;
  }
}
