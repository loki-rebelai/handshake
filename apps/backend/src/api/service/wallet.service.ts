import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, getAccount } from '@solana/spl-token';
import { SolanaService } from '../../solana/solana.service';
import { Token } from '../../db/models/Token';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly solanaService: SolanaService,
    @InjectRepository(Token)
    private readonly tokenRepo: EntityRepository<Token>,
  ) {}

  async getBalances(address: string) {
    this.logger.log(`getBalances: ${address}`);
    const connection = this.solanaService.getConnection();
    const pubkey = new PublicKey(address);

    // SOL balance
    const lamports = await connection.getBalance(pubkey);
    const sol = lamports / 1e9;

    // Token balances for all known tokens
    const tokens = await this.tokenRepo.findAll();
    const tokenBalances: Array<{ symbol: string; mint: string; balance: string; decimals: number }> = [];

    for (const token of tokens) {
      try {
        const mint = new PublicKey(token.mint);
        const ata = getAssociatedTokenAddressSync(mint, pubkey, true);
        const account = await getAccount(connection, ata);
        const balance = (Number(account.amount) / 10 ** token.decimals).toString();
        tokenBalances.push({ symbol: token.symbol, mint: token.mint, balance, decimals: token.decimals });
      } catch {
        tokenBalances.push({ symbol: token.symbol, mint: token.mint, balance: '0', decimals: token.decimals });
      }
    }

    return { sol, tokens: tokenBalances };
  }
}
