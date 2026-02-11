import {
  Controller,
  Get,
  Param,
  Query,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import { TransferService } from '../service/transfer.service';
import { SolanaService } from '../../solana/solana.service';
import { TransferStatus } from '../../db/models/Transfer';

@Controller('api/transfers')
export class TransferController {
  constructor(
    private readonly transferService: TransferService,
    private readonly solanaService: SolanaService,
  ) {}

  @Get()
  async listTransfers(@Query('wallet') wallet: string) {
    if (!wallet) {
      throw new BadRequestException({ ok: false, error: 'MISSING_WALLET', message: 'wallet query param is required' });
    }
    try {
      new PublicKey(wallet);
    } catch {
      throw new BadRequestException({ ok: false, error: 'INVALID_PUBKEY', message: 'wallet is not a valid public key' });
    }

    const transfers = await this.transferService.findByWallet(wallet);
    return { ok: true, data: { transfers } };
  }

  @Get(':pda')
  async getTransfer(@Param('pda') pda: string) {
    try {
      new PublicKey(pda);
    } catch {
      throw new BadRequestException({ ok: false, error: 'INVALID_PUBKEY', message: 'pda is not a valid public key' });
    }

    const transfer = await this.transferService.findByPda(pda);
    if (!transfer) {
      throw new NotFoundException({ ok: false, error: 'NOT_FOUND', message: 'Transfer not found' });
    }

    // For ACTIVE transfers, verify the on-chain PDA still exists
    if (transfer.status === TransferStatus.ACTIVE) {
      const handshake = this.solanaService.getHandshakeClient();
      const onChain = await handshake.fetchTransfer(new PublicKey(pda));
      if (!onChain) {
        throw new NotFoundException({ ok: false, error: 'NOT_FOUND', message: 'Transfer not found' });
      }
    }

    return { ok: true, data: { transfer } };
  }
}
