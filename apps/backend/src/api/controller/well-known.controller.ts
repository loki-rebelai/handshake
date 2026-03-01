import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../auth/public.decorator';

@Public()
@Controller('.well-known')
export class WellKnownController {
  private readonly network: string;

  constructor(private readonly configService: ConfigService) {
    const cluster = this.configService.get<string>('SOLANA_CLUSTER', 'devnet');
    this.network = cluster === 'mainnet-beta' ? 'solana-mainnet' : 'solana-devnet';
  }

  @Get('agent.json')
  agentJson() {
    return {
      name: 'SilkyWay',
      description:
        'Programmable stablecoin escrow payments on Solana for autonomous agents. Send, claim, and cancel time-locked payments with zero-config onboarding via CLI or HTTP API.',
      version: '1.0.4',
      content_type: 'documentation',
      capabilities: [
        'usdc-payments',
        'escrow',
        'time-locked-transfers',
        'agent-to-agent-commerce',
        'multi-wallet',
        'devnet-faucet',
      ],
      entry_points: {
        llm: '/llms.txt',
        navigation: '/nav.md',
        skill: '/skill.md',
        examples: '/examples/basic-escrow.md',
        changelog: '/CHANGELOG.md',
      },
      api: {
        base_url: 'https://api.silkyway.ai',
        endpoints: {
          create_transfer: 'POST /api/tx/create-transfer',
          claim_transfer: 'POST /api/tx/claim-transfer',
          cancel_transfer: 'POST /api/tx/cancel-transfer',
          submit: 'POST /api/tx/submit',
          faucet: 'POST /api/tx/faucet',
          list_transfers: 'GET /api/transfers?wallet={pubkey}',
          get_transfer: 'GET /api/transfers/{pda}',
          balance: 'GET /api/wallet/{address}/balance',
          tokens: 'GET /api/tokens',
        },
      },
      sdk: {
        package: '@silkysquad/silk',
        install: 'npm install -g @silkysquad/silk',
        cli: 'silk',
      },
      network: this.network,
      program_id: 'HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ',
      token: 'USDC',
      formats: ['markdown', 'json'],
      updated: '2026-02-10',
    };
  }
}
