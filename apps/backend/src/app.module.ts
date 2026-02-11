import { Module, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { ContentModule } from './content/content.module';
import { SolanaModule } from './solana/solana.module';
import { ApiModule } from './api/api.module';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.ENV_FILE || '.env',
    }),
    MikroOrmModule.forRoot({}),
    ServeStaticModule.forRoot(
      {
        rootPath: join(__dirname, '..', 'public'),
        serveRoot: '/',
        serveStaticOptions: { index: false },
      },
    ),
    ContentModule,
    SolanaModule,
    ApiModule,
    ChatModule,
  ],
  providers: [Logger],
})
export class AppModule {}
