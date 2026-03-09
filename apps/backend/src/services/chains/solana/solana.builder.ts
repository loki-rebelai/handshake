import { Injectable } from '@nestjs/common';
import { parseChain, type ActionIntent, type IntentV2 as Intent } from '@silkysquad/silk';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { SolanaService } from '../../../solana/solana.service';
import type { ChainBuilder, BuildOpts } from '../chain.interface';
import type { BuildResult } from '../../intent/types';
import type { ProgramBuilder, SolanaBuildContext } from './program-builder.interface';
import { NativeBuilder } from './programs/native.builder';
import { HandshakeBuilder } from './programs/handshake.builder';
import { JupiterBuilder } from './programs/jupiter.builder';
import { SolanaTransactionAssembler } from './solana-tx-assembler';
import { crossCheckProgram, resolveProgramAddress, resolveProgramName } from './program-registry';

type ProgramRef = {
  program?: string;
  programName?: string;
};

type IntentWithProgram = Intent & ProgramRef;

@Injectable()
export class SolanaBuilder implements ChainBuilder {
  readonly chain = 'solana';

  private readonly builders = new Map<string, ProgramBuilder>();

  constructor(
    private readonly solanaService: SolanaService,
    private readonly nativeBuilder: NativeBuilder,
    private readonly handshakeBuilder: HandshakeBuilder,
    private readonly jupiterBuilder: JupiterBuilder,
    private readonly assembler: SolanaTransactionAssembler,
  ) {
    this.builders.set('native', nativeBuilder);
    this.builders.set('handshake', handshakeBuilder);
    this.builders.set('jupiter', jupiterBuilder);
  }

  async build(intent: Intent, opts?: BuildOpts): Promise<BuildResult> {
    const { chain, network } = parseChain(intent.chain);
    if (chain !== 'solana') {
      throw new Error(`SolanaBuilder only handles solana intents, got '${chain}'`);
    }

    if (!('action' in intent)) {
      throw new Error('Compound intents are not supported by build v1; provide a single intent action.');
    }

    const action = this.extractAction(intent);
    const feePayer = new PublicKey(opts?.feePayer || this.getFeePayer(action));
    const signer = new PublicKey(this.getSigner(action, feePayer.toBase58()));

    const programRef = this.extractProgramRef(intent as IntentWithProgram);
    const builderName = this.resolveBuilderName(programRef, chain, network, action.action);
    const builder = this.builders.get(builderName);
    if (!builder) {
      throw new Error(`No Solana builder registered for program '${builderName}'`);
    }

    const context: SolanaBuildContext = {
      connection: this.solanaService.getConnection(),
      feePayer,
      signer,
      chain,
      network,
    };

    const result = await builder.build(action, context);
    const assembleResult = await this.assembler.assemble({
      instructions: result.instructions,
      feePayer,
      signer,
      connection: context.connection,
      addressLookupTableAddresses: result.addressLookupTableAddresses,
    });

    const metadataProgram = this.resolveMetadataProgram(programRef, builderName, action, chain, network);

    return {
      transaction: assembleResult.transaction,
      intent,
      metadata: {
        chain,
        network,
        programName: programRef.programName || builderName,
        program: metadataProgram,
        estimatedFee: `${assembleResult.priorityFee} microLamports`,
      },
    };
  }

  private extractAction(intent: Intent): ActionIntent {
    const {
      chain: _chain,
      strict: _strict,
      program: _program,
      programName: _programName,
      ...action
    } = intent as IntentWithProgram;
    return action as ActionIntent;
  }

  private getFeePayer(action: ActionIntent): string {
    const withAddresses = action as Record<string, unknown>;
    const from = withAddresses['from'];
    if (typeof from === 'string') {
      return from;
    }

    const owner = withAddresses['owner'];
    if (typeof owner === 'string') {
      return owner;
    }

    throw new Error('Unable to infer fee payer. Provide opts.feePayer.');
  }

  private getSigner(action: ActionIntent, fallback: string): string {
    const withAddresses = action as Record<string, unknown>;
    const from = withAddresses['from'];
    if (typeof from === 'string') {
      return from;
    }

    const owner = withAddresses['owner'];
    if (typeof owner === 'string') {
      return owner;
    }

    return fallback;
  }

  private extractProgramRef(intent: IntentWithProgram): ProgramRef {
    return {
      program: intent.program,
      programName: intent.programName,
    };
  }

  private resolveBuilderName(
    programRef: ProgramRef,
    chain: string,
    network: string,
    action?: string,
  ): string {
    if (programRef.programName && programRef.program) {
      const matches = crossCheckProgram(chain, network, programRef.programName, programRef.program);
      if (!matches) {
        throw new Error(
          `Program mismatch: '${programRef.programName}' does not match '${programRef.program}' on ${chain}:${network}`,
        );
      }
    }

    if (programRef.programName) {
      return programRef.programName;
    }

    if (programRef.program) {
      if (
        programRef.program === SystemProgram.programId.toBase58()
        || programRef.program === TOKEN_PROGRAM_ID.toBase58()
      ) {
        return 'native';
      }

      const resolved = resolveProgramAddress(chain, network, programRef.program);
      if (!resolved) {
        throw new Error(
          `Unsupported Solana program address '${programRef.program}' for build v1`,
        );
      }
      return resolved.name;
    }

    if (action === 'swap') {
      return 'jupiter';
    }

    return 'native';
  }

  private resolveMetadataProgram(
    programRef: ProgramRef,
    builderName: string,
    action: ActionIntent,
    chain: string,
    network: string,
  ): string {
    if (programRef.program) {
      return programRef.program;
    }

    if (builderName !== 'native') {
      const resolved = resolveProgramName(chain, network, builderName);
      if (resolved) {
        return resolved.address;
      }
    }

    const tokenSymbol = (action as Record<string, unknown>)['tokenSymbol'];
    const hasToken = typeof (action as Record<string, unknown>)['token'] === 'string';
    if (hasToken || (typeof tokenSymbol === 'string' && tokenSymbol.toUpperCase() !== 'SOL')) {
      return TOKEN_PROGRAM_ID.toBase58();
    }

    return SystemProgram.programId.toBase58();
  }
}
