import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { firstValueFrom } from 'rxjs';

export interface JupiterSwapInfo {
  ammKey: string;
  label: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  feeAmount: string;
  feeMint: string;
}

export interface JupiterRoutePlanItem {
  swapInfo: JupiterSwapInfo;
  percent: number;
  bps: number;
}

export interface JupiterQuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: 'ExactIn' | 'ExactOut';
  slippageBps: number;
  priceImpactPct: string;
  routePlan: JupiterRoutePlanItem[];
  contextSlot: number;
  timeTaken: number;
}

interface JupiterInstructionAccount {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

interface JupiterInstruction {
  programId: string;
  accounts: JupiterInstructionAccount[];
  data: string;
}

interface JupiterSwapInstructionsResponse {
  otherInstructions: JupiterInstruction[];
  computeBudgetInstructions: JupiterInstruction[];
  setupInstructions: JupiterInstruction[];
  swapInstruction: JupiterInstruction;
  addressLookupTableAddresses: string[];
  cleanupInstruction: JupiterInstruction | null;
}

export interface JupiterSwapInstructionsResult {
  instructions: TransactionInstruction[];
  addressLookupTableAddresses: string[];
  outAmount: string;
}

const DEFAULT_JUPITER_API_URL = 'https://api.jup.ag/swap/v1';

@Injectable()
export class JupiterClient {
  private readonly apiKey: string;
  private readonly apiUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.apiKey = this.configService.get<string>('JUPITER_API_KEY', '');
    this.apiUrl = this.configService.get<string>('JUPITER_API_URL', DEFAULT_JUPITER_API_URL);
  }

  async getQuote(params: {
    inputMint: string;
    outputMint: string;
    amount: string;
    slippageBps: number;
  }): Promise<JupiterQuoteResponse> {
    const response = await firstValueFrom(
      this.httpService.get<JupiterQuoteResponse>(`${this.apiUrl}/quote`, {
        params: {
          inputMint: params.inputMint,
          outputMint: params.outputMint,
          amount: params.amount,
          slippageBps: params.slippageBps,
        },
        headers: this.headers(),
      }),
    );
    return response.data;
  }

  async getSwapInstructions(params: {
    quote: JupiterQuoteResponse;
    signer: string;
  }): Promise<JupiterSwapInstructionsResult> {
    const response = await firstValueFrom(
      this.httpService.post<JupiterSwapInstructionsResponse>(
        `${this.apiUrl}/swap-instructions`,
        {
          quoteResponse: params.quote,
          userPublicKey: params.signer,
          wrapUnwrapSOL: true,
          prioritizationFeeLamports: 'auto',
        },
        { headers: this.headers() },
      ),
    );

    const convertedInstructions: TransactionInstruction[] = [];
    const push = (ix: JupiterInstruction | null | undefined) => {
      if (!ix) {
        return;
      }
      convertedInstructions.push(this.convertInstruction(ix));
    };

    for (const ix of response.data.otherInstructions ?? []) {
      push(ix);
    }
    for (const ix of response.data.setupInstructions ?? []) {
      push(ix);
    }
    push(response.data.swapInstruction);
    push(response.data.cleanupInstruction);

    return {
      instructions: convertedInstructions,
      addressLookupTableAddresses: response.data.addressLookupTableAddresses ?? [],
      outAmount: params.quote.outAmount,
    };
  }

  private convertInstruction(ix: JupiterInstruction): TransactionInstruction {
    return new TransactionInstruction({
      programId: new PublicKey(ix.programId),
      keys: ix.accounts.map((account) => ({
        pubkey: new PublicKey(account.pubkey),
        isSigner: account.isSigner,
        isWritable: account.isWritable,
      })),
      data: Buffer.from(ix.data, 'base64'),
    });
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }
    return headers;
  }
}
