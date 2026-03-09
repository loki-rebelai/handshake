import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { SolanaModule } from '../../../solana/solana.module';
import { NativeBuilder } from './programs/native.builder';
import { HandshakeBuilder } from './programs/handshake.builder';
import { JupiterBuilder } from './programs/jupiter.builder';
import { JupiterClient } from './jupiter-client';
import { SolanaBuilder } from './solana.builder';
import { SolanaAnalyzer } from './solana.analyzer';
import { SolanaTransactionAssembler } from './solana-tx-assembler';

@Module({
  imports: [SolanaModule, HttpModule],
  providers: [
    NativeBuilder,
    HandshakeBuilder,
    JupiterBuilder,
    JupiterClient,
    SolanaBuilder,
    SolanaAnalyzer,
    SolanaTransactionAssembler,
  ],
  exports: [SolanaBuilder, SolanaAnalyzer],
})
export class SolanaChainModule {}
