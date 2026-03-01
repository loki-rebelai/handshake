import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Transfer } from '../db/models/Transfer';
import { Pool } from '../db/models/Pool';
import { Token } from '../db/models/Token';
import { SilkAccount } from '../db/models/SilkAccount';
import { SilkAccountOperator } from '../db/models/SilkAccountOperator';
import { SilkAccountEvent } from '../db/models/SilkAccountEvent';
import { ApiKey } from '../db/models/ApiKey';
import { TxController } from './controller/tx.controller';
import { TransferController } from './controller/transfer.controller';
import { TokenController } from './controller/token.controller';
import { WalletController } from './controller/wallet.controller';
import { AccountController } from './controller/account.controller';
import { WellKnownController } from './controller/well-known.controller';
import { AuthController } from './auth/auth.controller';
import { TxService } from './service/tx.service';
import { TransferService } from './service/transfer.service';
import { TokenService } from './service/token.service';
import { WalletService } from './service/wallet.service';
import { AccountService } from './service/account.service';
import { AuthService } from './auth/auth.service';

@Module({
  imports: [
    MikroOrmModule.forFeature([Transfer, Pool, Token, SilkAccount, SilkAccountOperator, SilkAccountEvent, ApiKey]),
  ],
  controllers: [
    TxController,
    TransferController,
    TokenController,
    WalletController,
    AccountController,
    WellKnownController,
    AuthController,
  ],
  providers: [TxService, TransferService, TokenService, WalletService, AccountService, AuthService],
  exports: [AuthService],
})
export class ApiModule {}
