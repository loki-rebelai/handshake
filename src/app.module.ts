import { Module, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { ContentModule } from './content/content.module';
import { SolanaModule } from './solana/solana.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MikroOrmModule.forRoot({}),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '.well-known'),
      serveRoot: '/.well-known',
    }),
    ContentModule,
    SolanaModule,
  ],
  providers: [Logger],
})
export class AppModule {}
