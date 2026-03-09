import { Injectable } from '@nestjs/common';
import {
  createTokenRegistry,
  type ActionIntent,
  type SwapIntent,
  type TokenRef,
} from '@silkysquad/silk';
import { getMint } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import type {
  ProgramBuilder,
  ProgramBuildResult,
  SolanaBuildContext,
} from '../program-builder.interface';
import { JupiterClient } from '../jupiter-client';
import { requireExactAmount, toBaseUnits } from '../amount';

const DEFAULT_SLIPPAGE_BPS = 10;
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const SOL_DECIMALS = 9;

interface ResolvedToken {
  mint: string;
  decimals?: number;
}

@Injectable()
export class JupiterBuilder implements ProgramBuilder {
  readonly programName = 'jupiter';
  readonly supportedActions = ['swap'];

  constructor(private readonly jupiterClient: JupiterClient) {}

  async build(action: ActionIntent, context: SolanaBuildContext): Promise<ProgramBuildResult> {
    if (action.action !== 'swap') {
      throw new Error(`JupiterBuilder: action '${action.action}' not supported. Supported: swap`);
    }

    if (context.network !== 'mainnet') {
      throw new Error(`Jupiter swap build is currently supported only on solana:mainnet`);
    }

    const swap = action as SwapIntent;
    if (!swap.amountIn) {
      throw new Error('Swap build requires amountIn as an exact amount');
    }

    const tokenIn = this.resolveTokenRef(swap.tokenIn, context.chain, context.network);
    const tokenOut = this.resolveTokenRef(swap.tokenOut, context.chain, context.network);
    const amountIn = requireExactAmount(swap.amountIn);
    const amountInBaseUnits = await this.resolveAmountBaseUnits(amountIn, tokenIn, context);
    const slippageBps = this.toSlippageBps(swap.slippage);

    const quote = await this.jupiterClient.getQuote({
      inputMint: tokenIn.mint,
      outputMint: tokenOut.mint,
      amount: amountInBaseUnits,
      slippageBps,
    });

    const swapInstructions = await this.jupiterClient.getSwapInstructions({
      quote,
      signer: context.signer.toBase58(),
    });

    return {
      instructions: swapInstructions.instructions,
      addressLookupTableAddresses: swapInstructions.addressLookupTableAddresses,
      metadata: {
        inAmount: quote.inAmount,
        outAmount: swapInstructions.outAmount,
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        priceImpactPct: quote.priceImpactPct,
        routePlan: quote.routePlan,
        slippageBps,
      },
    };
  }

  private resolveTokenRef(ref: TokenRef, chain: string, network: string): ResolvedToken {
    const registry = createTokenRegistry();
    const symbol = ref.tokenSymbol?.toUpperCase();

    if (!ref.token && !symbol) {
      throw new Error('SwapIntent token reference must include token or tokenSymbol');
    }

    const fromSymbol = (() => {
      if (!symbol) {
        return null;
      }
      if (symbol === 'SOL') {
        return { address: SOL_MINT, decimals: SOL_DECIMALS };
      }
      return registry.resolveSymbol(chain, network, symbol);
    })();

    if (symbol && !fromSymbol) {
      throw new Error(`Could not resolve token symbol '${symbol}' on ${chain}:${network}`);
    }

    if (ref.token && fromSymbol && fromSymbol.address !== ref.token) {
      throw new Error(
        `Swap token mismatch for symbol '${symbol}': ${ref.token} != ${fromSymbol.address} on ${chain}:${network}`,
      );
    }

    if (ref.token) {
      const resolvedAddress = registry.resolveAddress(chain, network, ref.token);
      return {
        mint: ref.token,
        decimals: resolvedAddress?.decimals ?? fromSymbol?.decimals,
      };
    }

    return {
      mint: fromSymbol!.address,
      decimals: fromSymbol!.decimals,
    };
  }

  private async resolveAmountBaseUnits(
    humanAmount: string,
    token: ResolvedToken,
    context: SolanaBuildContext,
  ): Promise<string> {
    const decimals = token.decimals ?? await this.resolveTokenDecimals(token.mint, context);
    return toBaseUnits(humanAmount, decimals).toString();
  }

  private async resolveTokenDecimals(mint: string, context: SolanaBuildContext): Promise<number> {
    if (mint === SOL_MINT) {
      return SOL_DECIMALS;
    }
    const mintInfo = await getMint(context.connection, new PublicKey(mint));
    return mintInfo.decimals;
  }

  private toSlippageBps(slippage?: number): number {
    if (slippage === undefined) {
      return DEFAULT_SLIPPAGE_BPS;
    }
    if (!Number.isFinite(slippage) || slippage < 0 || slippage > 1) {
      throw new Error(`Invalid slippage '${slippage}'. Expected a decimal value between 0 and 1.`);
    }
    return Math.round(slippage * 10_000);
  }
}
