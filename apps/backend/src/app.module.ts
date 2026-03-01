import { Module, Logger } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { ContentModule } from './content/content.module';
import { SolanaModule } from './solana/solana.module';
import { ApiModule } from './api/api.module';
import { ChatModule } from './chat/chat.module';
import { ApiKeyGuard } from './api/auth/auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.ENV_FILE || '.env',
    }),
    MikroOrmModule.forRoot({}),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      serveRoot: '/',
      serveStaticOptions: { index: false },
    }),
    ContentModule,
    SolanaModule,
    ApiModule,
    ChatModule,
  ],
  providers: [
    Logger,
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
  ],
})
export class AppModule {}
