import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';
import { Transfer } from '../../db/models/Transfer';

@Injectable()
export class TransferService {
  constructor(
    @InjectRepository(Transfer)
    private readonly transferRepo: EntityRepository<Transfer>,
  ) {}

  async findByWallet(wallet: string): Promise<Transfer[]> {
    return this.transferRepo.find(
      { $or: [{ sender: wallet }, { recipient: wallet }] },
      { populate: ['token', 'pool'], orderBy: { createdAt: 'DESC' } },
    );
  }

  async findByPda(pda: string): Promise<Transfer | null> {
    return this.transferRepo.findOne(
      { transferPda: pda },
      { populate: ['token', 'pool'] },
    );
  }

  async findRecent(limit = 50): Promise<Transfer[]> {
    return this.transferRepo.find(
      {},
      { populate: ['token', 'pool'], orderBy: { createdAt: 'DESC' }, limit },
    );
  }

  async countAll(): Promise<number> {
    return this.transferRepo.count();
  }
}
