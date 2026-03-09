import { Injectable } from '@nestjs/common';
import {
  analyzeTransaction,
  createTokenRegistry,
  parseChain,
  verifyIntentV2,
  type IntentV2 as Intent,
  type RiskFlag,
  type SwapIntent,
  type TokenRef,
  type TransactionAnalysis,
} from '@silkysquad/silk';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, getMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { SolanaService } from '../../../solana/solana.service';
import type { ChainAnalyzer, AnalyzeOpts } from '../chain.interface';
import type {
  AnalyzeResult,
  MatchDimension,
  RiskDimension,
  ViabilityDimension,
} from '../../intent/types';
import { deriveVerdict } from '../../intent/types';
import { requireExactAmount, toBaseUnits } from './amount';
import { crossCheckProgram, resolveProgramName } from './program-registry';
import { JupiterClient } from './jupiter-client';

type ProgramRef = {
  program?: string;
  programName?: string;
};

type IntentWithProgram = Intent & ProgramRef;

interface NativeTransferCheck {
  matched: boolean;
  discrepancies: string[];
}

interface ResolvedTokenRef {
  address: string;
  decimals?: number;
}

@Injectable()
export class SolanaAnalyzer implements ChainAnalyzer {
  readonly chain = 'solana';

  constructor(
    private readonly solanaService: SolanaService,
    private readonly jupiterClient: JupiterClient,
  ) {}

  async analyze(tx: string, intent: Intent, opts?: AnalyzeOpts): Promise<AnalyzeResult> {
    const { chain, network } = parseChain(intent.chain);
    if (chain !== 'solana') {
      throw new Error(`SolanaAnalyzer only handles solana intents, got '${chain}'`);
    }

    const connection = this.solanaService.getConnection();
    const raw = await analyzeTransaction(tx, { connection });
    const verifyResult = await verifyIntentV2(tx, intent, { connection });

    const discrepancies = [...verifyResult.discrepancies];

    this.applyProgramChecks(intent as IntentWithProgram, raw, chain, network, discrepancies);

    const nativeFallback = await this.checkNativeTransferFallback(intent as IntentWithProgram, raw, chain, network);
    if (!verifyResult.matched && nativeFallback.discrepancies.length > 0) {
      discrepancies.push(...nativeFallback.discrepancies);
    }

    const swapCheck = await this.checkSwapMatch(intent as IntentWithProgram, raw, chain, network);
    if (swapCheck.discrepancies.length > 0) {
      discrepancies.push(...swapCheck.discrepancies);
    }

    const hasMatchSignal = verifyResult.matched || nativeFallback.matched || swapCheck.matched;
    const matched = hasMatchSignal && discrepancies.length === 0;
    const match: MatchDimension = {
      level: matched ? 'full' : this.inferMatchLevel(intent as IntentWithProgram, raw, hasMatchSignal),
      discrepancies,
    };

    const isSwap = 'action' in intent && intent.action === 'swap';
    const risk = isSwap
      ? await this.assessSwapRisk(intent as IntentWithProgram, chain, network, raw.flags)
      : this.assessRisk(raw.flags);
    const viability = opts?.checkViability === false
      ? { level: 'viable' as const, issues: [] }
      : isSwap
        ? await this.checkSwapViability(intent as IntentWithProgram, chain, network)
        : await this.checkViability(intent as IntentWithProgram, chain, network);

    return {
      verdict: deriveVerdict(match, risk, viability),
      match,
      risk,
      viability,
      raw,
    };
  }

  private applyProgramChecks(
    intent: IntentWithProgram,
    raw: TransactionAnalysis,
    chain: string,
    network: string,
    discrepancies: string[],
  ): void {
    const ref = this.extractProgramRef(intent);
    if (!ref.program && !ref.programName) {
      return;
    }

    if (ref.program && ref.programName) {
      const valid = crossCheckProgram(chain, network, ref.programName, ref.program);
      if (!valid) {
        discrepancies.push(
          `Program mismatch: '${ref.programName}' does not match '${ref.program}' on ${chain}:${network}`,
        );
        return;
      }
    }

    if (ref.programName === 'native' && !ref.program) {
      const hasNativeInstruction = raw.instructions.some(
        (ix) => ix.programId === SystemProgram.programId.toBase58() || ix.programId === TOKEN_PROGRAM_ID.toBase58(),
      );
      if (!hasNativeInstruction) {
        discrepancies.push('Expected a native Solana transfer instruction, but none was found');
      }
      return;
    }

    const expectedProgram = ref.program
      ?? (ref.programName ? resolveProgramName(chain, network, ref.programName)?.address : undefined);

    if (!expectedProgram) {
      discrepancies.push(`Unknown programName '${ref.programName}' on ${chain}:${network}`);
      return;
    }

    const hasInstructionFromProgram = raw.instructions.some((ix) => ix.programId === expectedProgram);
    if (!hasInstructionFromProgram) {
      discrepancies.push(
        `Expected a call to program '${expectedProgram}' but transaction uses: ${[...new Set(raw.instructions.map((ix) => ix.programId))].join(', ')}`,
      );
    }
  }

  private inferMatchLevel(intent: IntentWithProgram, raw: TransactionAnalysis, hadMatchSignal: boolean): MatchDimension['level'] {
    if (hadMatchSignal) {
      return 'partial';
    }

    if ('action' in intent) {
      const expectedAction = intent.action;
      const hasRelated = raw.instructions.some((ix) => this.matchesAction(expectedAction, ix.type));
      return hasRelated ? 'partial' : 'none';
    }

    return 'none';
  }

  private matchesAction(action: string, ixType: string | null): boolean {
    if (!ixType) {
      return false;
    }

    if (ixType === action) {
      return true;
    }

    if (action === 'transfer' && (ixType === 'create_transfer' || ixType === 'transfer_checked')) {
      return true;
    }

    if (action === 'swap' && ixType === 'swap') {
      return true;
    }

    return false;
  }

  private async checkSwapMatch(
    intent: IntentWithProgram,
    raw: TransactionAnalysis,
    chain: string,
    network: string,
  ): Promise<NativeTransferCheck> {
    if (!('action' in intent) || intent.action !== 'swap') {
      return { matched: false, discrepancies: [] };
    }

    const discrepancies: string[] = [];
    const swap = intent as unknown as SwapIntent;
    const expectedJupiter = resolveProgramName(chain, network, 'jupiter')?.address;

    if (expectedJupiter) {
      const hasJupiterIx = raw.instructions.some((ix) => ix.programId === expectedJupiter);
      if (!hasJupiterIx) {
        discrepancies.push('Transaction does not contain Jupiter program instructions');
      }
    }

    const tokenIn = this.resolveSwapTokenRef(swap.tokenIn, chain, network);
    const tokenOut = this.resolveSwapTokenRef(swap.tokenOut, chain, network);

    if (tokenIn && !this.instructionMentionsAddress(raw, tokenIn.address)) {
      discrepancies.push(`Input token ${tokenIn.address} not found in transaction`);
    }
    if (tokenOut && !this.instructionMentionsAddress(raw, tokenOut.address)) {
      discrepancies.push(`Output token ${tokenOut.address} not found in transaction`);
    }

    return { matched: discrepancies.length === 0, discrepancies };
  }

  private async assessSwapRisk(
    intent: IntentWithProgram,
    chain: string,
    network: string,
    existingFlags: RiskFlag[],
  ): Promise<RiskDimension> {
    if (!('action' in intent) || intent.action !== 'swap') {
      return this.assessRisk(existingFlags);
    }

    const flags: RiskFlag[] = [...existingFlags];
    const swap = intent as unknown as SwapIntent;
    const tokenIn = this.resolveSwapTokenRef(swap.tokenIn, chain, network);
    const tokenOut = this.resolveSwapTokenRef(swap.tokenOut, chain, network);
    const amountIn = swap.amountIn ? this.tryRequireExactAmount(swap.amountIn) : null;

    if (!tokenIn || !tokenOut || !amountIn) {
      return this.assessRisk(flags);
    }

    try {
      const amountBaseUnits = await this.resolveSwapAmountBaseUnits(
        amountIn,
        tokenIn,
        this.solanaService.getConnection(),
      );
      const quote = await this.jupiterClient.getQuote({
        inputMint: tokenIn.address,
        outputMint: tokenOut.address,
        amount: amountBaseUnits,
        slippageBps: this.toSlippageBps(swap.slippage),
      });
      const priceImpact = Number.parseFloat(quote.priceImpactPct);
      if (Number.isFinite(priceImpact)) {
        if (priceImpact > 5) {
          flags.push({
            code: 'HIGH_PRICE_IMPACT',
            severity: 'error',
            message: `Price impact ${priceImpact}% exceeds 5% threshold`,
          });
        } else if (priceImpact > 1) {
          flags.push({
            code: 'MODERATE_PRICE_IMPACT',
            severity: 'warning',
            message: `Price impact ${priceImpact}% exceeds 1% threshold`,
          });
        }
      }
    } catch {
      // Ignore quote errors in risk scoring and keep base risk only.
    }

    return this.assessRisk(flags);
  }

  private async checkSwapViability(
    intent: IntentWithProgram,
    chain: string,
    network: string,
  ): Promise<ViabilityDimension> {
    if (!('action' in intent) || intent.action !== 'swap') {
      return { level: 'viable', issues: [] };
    }

    const issues: string[] = [];
    const connection = this.solanaService.getConnection();
    const swap = intent as unknown as SwapIntent;

    let fromKey: PublicKey;
    try {
      fromKey = new PublicKey(swap.from);
    } catch {
      return { level: 'unviable', issues: [`Invalid sender public key '${swap.from}'`] };
    }

    const amountIn = swap.amountIn ? this.tryRequireExactAmount(swap.amountIn) : null;
    if (!amountIn) {
      return { level: 'uncertain', issues: ['Swap viability check requires exact amountIn'] };
    }

    try {
      const balance = await connection.getBalance(fromKey, 'confirmed');
      if (balance < 10_000) {
        issues.push(`Insufficient SOL for transaction fees: have ${(balance / 1e9).toFixed(9)} SOL`);
      }
    } catch {
      issues.push('Could not verify SOL balance via RPC');
    }

    const tokenIn = this.resolveSwapTokenRef(swap.tokenIn, chain, network);
    if (!tokenIn) {
      issues.push('Could not resolve swap input token');
      return this.viabilityFromIssues(issues);
    }

    try {
      const requiredRaw = BigInt(await this.resolveSwapAmountBaseUnits(amountIn, tokenIn, connection));
      if (tokenIn.address === 'So11111111111111111111111111111111111111112') {
        const solBalance = await connection.getBalance(fromKey, 'confirmed');
        if (BigInt(solBalance) < requiredRaw + 10_000n) {
          issues.push(
            `Insufficient SOL balance: need ${(Number(requiredRaw + 10_000n) / 1e9).toFixed(9)} SOL (including fee buffer), have ${(solBalance / 1e9).toFixed(9)} SOL`,
          );
        }
      } else {
        const mintKey = new PublicKey(tokenIn.address);
        const sourceAta = getAssociatedTokenAddressSync(mintKey, fromKey, true);
        const tokenBalance = await connection.getTokenAccountBalance(sourceAta, 'confirmed');
        const availableRaw = BigInt(tokenBalance.value.amount);
        if (availableRaw < requiredRaw) {
          issues.push(
            `Insufficient input token balance: need ${requiredRaw.toString()} raw units, have ${availableRaw.toString()} raw units`,
          );
        }
      }
    } catch {
      issues.push('Could not verify input token balance');
    }

    return this.viabilityFromIssues(issues);
  }

  private assessRisk(flags: RiskFlag[]): RiskDimension {
    const hasError = flags.some((flag) => flag.severity === 'error');
    const hasWarning = flags.some((flag) => flag.severity === 'warning');

    return {
      level: hasError ? 'high' : hasWarning ? 'medium' : 'low',
      flags,
    };
  }

  private async checkViability(
    intent: IntentWithProgram,
    chain: string,
    network: string,
  ): Promise<ViabilityDimension> {
    if (!('action' in intent) || intent.action !== 'transfer') {
      return { level: 'viable', issues: [] };
    }

    const transfer = intent as IntentWithProgram & {
      from?: unknown;
      amount?: unknown;
      token?: unknown;
      tokenSymbol?: unknown;
    };
    const issues: string[] = [];
    const connection = this.solanaService.getConnection();

    if (typeof transfer.from !== 'string') {
      return { level: 'unviable', issues: ['Transfer intent is missing a valid from address'] };
    }
    const from = transfer.from;
    try {
      new PublicKey(from);
    } catch {
      return { level: 'unviable', issues: [`Invalid sender public key '${from}'`] };
    }

    const fromKey = new PublicKey(from);
    const exactAmount = (() => {
      try {
        return requireExactAmount(transfer.amount as any);
      } catch (err) {
        issues.push((err as Error).message);
        return null;
      }
    })();

    const token = typeof transfer.token === 'string' ? transfer.token : undefined;
    const tokenSymbol = typeof transfer.tokenSymbol === 'string' ? transfer.tokenSymbol : undefined;

    if (!token && (!tokenSymbol || tokenSymbol.toUpperCase() === 'SOL')) {
      try {
        const balance = await connection.getBalance(fromKey, 'confirmed');
        if (exactAmount) {
          const requiredLamports = toBaseUnits(exactAmount, 9) + 5000n;
          if (BigInt(balance) < requiredLamports) {
            issues.push(
              `Insufficient SOL balance: need ${(Number(requiredLamports) / 1e9).toFixed(9)} SOL (including fee buffer), have ${(balance / 1e9).toFixed(9)} SOL`,
            );
          }
        }
      } catch {
        issues.push('Could not verify SOL balance via RPC');
      }

      return this.viabilityFromIssues(issues);
    }

    const mint = this.resolveMintAddress({ token, tokenSymbol }, chain, network, issues);
    if (!mint || !exactAmount) {
      return this.viabilityFromIssues(issues);
    }

    try {
      const mintKey = new PublicKey(mint);
      const mintInfo = await getMint(connection, mintKey);
      const requiredRaw = toBaseUnits(exactAmount, mintInfo.decimals);

      const sourceAta = getAssociatedTokenAddressSync(mintKey, fromKey, true);
      const tokenBalance = await connection.getTokenAccountBalance(sourceAta, 'confirmed');
      const availableRaw = BigInt(tokenBalance.value.amount);
      if (availableRaw < requiredRaw) {
        issues.push(
          `Insufficient token balance: need ${requiredRaw.toString()} raw units, have ${availableRaw.toString()} raw units`,
        );
      }
    } catch {
      issues.push('Could not verify token balance; source token account may not exist');
    }

    return this.viabilityFromIssues(issues);
  }

  private resolveMintAddress(
    intent: { token?: string; tokenSymbol?: string },
    chain: string,
    network: string,
    issues: string[],
  ): string | null {
    if (intent.token) {
      return intent.token;
    }

    if (!intent.tokenSymbol) {
      issues.push('Token transfer intent is missing token/tokenSymbol');
      return null;
    }

    const registry = createTokenRegistry();
    const resolved = registry.resolveSymbol(chain, network, intent.tokenSymbol.toUpperCase());
    if (!resolved) {
      issues.push(`Could not resolve token symbol '${intent.tokenSymbol}' on ${chain}:${network}`);
      return null;
    }

    return resolved.address;
  }

  private viabilityFromIssues(issues: string[]): ViabilityDimension {
    if (issues.some((issue) => issue.startsWith('Insufficient') || issue.startsWith('Invalid'))) {
      return { level: 'unviable', issues };
    }

    if (issues.length > 0) {
      return { level: 'uncertain', issues };
    }

    return { level: 'viable', issues: [] };
  }

  private async checkNativeTransferFallback(
    intent: IntentWithProgram,
    raw: TransactionAnalysis,
    chain: string,
    network: string,
  ): Promise<NativeTransferCheck> {
    if (!('action' in intent) || intent.action !== 'transfer') {
      return { matched: false, discrepancies: [] };
    }

    const transfer = intent as IntentWithProgram & {
      from?: unknown;
      to?: unknown;
      amount?: unknown;
      token?: unknown;
      tokenSymbol?: unknown;
    };
    if (typeof transfer.from !== 'string' || typeof transfer.to !== 'string') {
      return { matched: false, discrepancies: ['Transfer intent is missing from/to addresses'] };
    }

    const ref = this.extractProgramRef(intent);
    if (ref.programName && ref.programName !== 'native') {
      return { matched: false, discrepancies: [] };
    }

    const exactAmount = (() => {
      try {
        return requireExactAmount(transfer.amount as any);
      } catch (err) {
        return { error: (err as Error).message };
      }
    })();

    if (typeof exactAmount !== 'string') {
      return { matched: false, discrepancies: [exactAmount.error] };
    }

    const transferIxs = raw.instructions.filter((ix) => ix.type === 'transfer' || ix.type === 'transfer_checked');
    if (transferIxs.length === 0) {
      return { matched: false, discrepancies: [] };
    }

    for (const ix of transferIxs) {
      if (ix.programId === SystemProgram.programId.toBase58()) {
        const from = ix.params['from'];
        const to = ix.params['to'];
        const lamports = ix.params['lamports'];
        if (from === transfer.from && to === transfer.to && lamports === toBaseUnits(exactAmount, 9).toString()) {
          return { matched: true, discrepancies: [] };
        }
        continue;
      }

      if (ix.programId === TOKEN_PROGRAM_ID.toBase58()) {
        const authority = ix.params['authority'];
        if (authority !== transfer.from) {
          continue;
        }

        const mintAddress = this.resolveMintAddress(
          {
            token: typeof transfer.token === 'string' ? transfer.token : undefined,
            tokenSymbol: typeof transfer.tokenSymbol === 'string' ? transfer.tokenSymbol : undefined,
          },
          chain,
          network,
          [],
        );
        if (!mintAddress) {
          return { matched: false, discrepancies: ['Unable to verify SPL transfer target token mint'] };
        }

        const mint = new PublicKey(mintAddress);
        const mintInfo = await getMint(this.solanaService.getConnection(), mint);
        const requiredRaw = toBaseUnits(exactAmount, mintInfo.decimals).toString();

        const destination = ix.params['destination'];
        const expectedDestination = getAssociatedTokenAddressSync(mint, new PublicKey(transfer.to), true).toBase58();
        const amount = ix.params['amount'];

        if (destination === expectedDestination && amount === requiredRaw) {
          return { matched: true, discrepancies: [] };
        }
      }
    }

    return {
      matched: false,
      discrepancies: ['Transaction transfer instruction did not match expected sender/recipient/amount for native transfer'],
    };
  }

  private instructionMentionsAddress(raw: TransactionAnalysis, address: string): boolean {
    return raw.instructions.some((ix) => {
      const params = ix.params ?? {};
      return Object.values(params).some((value) => value === address);
    });
  }

  private resolveSwapTokenRef(ref: TokenRef, chain: string, network: string): ResolvedTokenRef | null {
    const registry = createTokenRegistry();
    const symbol = ref.tokenSymbol?.toUpperCase();

    const fromSymbol = (() => {
      if (!symbol) {
        return null;
      }
      if (symbol === 'SOL') {
        return { address: 'So11111111111111111111111111111111111111112', decimals: 9 };
      }
      return registry.resolveSymbol(chain, network, symbol);
    })();

    if (symbol && !fromSymbol) {
      return null;
    }

    if (ref.token && fromSymbol && fromSymbol.address !== ref.token) {
      return null;
    }

    if (ref.token) {
      const fromAddress = registry.resolveAddress(chain, network, ref.token);
      return {
        address: ref.token,
        decimals: fromAddress?.decimals ?? fromSymbol?.decimals,
      };
    }

    if (fromSymbol) {
      return { address: fromSymbol.address, decimals: fromSymbol.decimals };
    }

    return null;
  }

  private async resolveSwapAmountBaseUnits(
    amount: string,
    token: ResolvedTokenRef,
    connection: ReturnType<SolanaService['getConnection']>,
  ): Promise<string> {
    const decimals = token.decimals ?? await this.resolveSwapTokenDecimals(token.address, connection);
    return toBaseUnits(amount, decimals).toString();
  }

  private async resolveSwapTokenDecimals(
    mint: string,
    connection: ReturnType<SolanaService['getConnection']>,
  ): Promise<number> {
    if (mint === 'So11111111111111111111111111111111111111112') {
      return 9;
    }
    const mintInfo = await getMint(connection, new PublicKey(mint));
    return mintInfo.decimals;
  }

  private tryRequireExactAmount(amount: unknown): string | null {
    try {
      return requireExactAmount(amount as string);
    } catch {
      return null;
    }
  }

  private toSlippageBps(slippage?: number): number {
    if (slippage === undefined) {
      return 10;
    }
    if (!Number.isFinite(slippage) || slippage < 0 || slippage > 1) {
      return 10;
    }
    return Math.round(slippage * 10_000);
  }

  private extractProgramRef(intent: IntentWithProgram): ProgramRef {
    return {
      program: intent.program,
      programName: intent.programName,
    };
  }
}
