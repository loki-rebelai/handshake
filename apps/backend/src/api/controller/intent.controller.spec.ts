import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { IntentController } from './intent.controller';
import { IntentBuildService } from '../../services/intent/intent-build.service';
import { IntentAnalyzeService } from '../../services/intent/intent-analyze.service';

describe('IntentController', () => {
  let controller: IntentController;
  let buildService: IntentBuildService;
  let analyzeService: IntentAnalyzeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [IntentController],
      providers: [
        {
          provide: IntentBuildService,
          useValue: {
            build: jest.fn(),
          },
        },
        {
          provide: IntentAnalyzeService,
          useValue: {
            analyze: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<IntentController>(IntentController);
    buildService = module.get<IntentBuildService>(IntentBuildService);
    analyzeService = module.get<IntentAnalyzeService>(IntentAnalyzeService);
  });

  it('rejects build when intent is missing', async () => {
    await expect(controller.build({} as any)).rejects.toThrow(BadRequestException);
  });

  it('build returns {ok,data} envelope', async () => {
    jest.spyOn(buildService, 'build').mockResolvedValue({
      transaction: 'abc',
      intent: { chain: 'solana', action: 'transfer' } as any,
      metadata: { chain: 'solana', network: 'mainnet' },
    });

    const result = await controller.build({
      intent: {
        chain: 'solana',
        action: 'transfer',
        from: 'Alice',
        to: 'Bob',
        amount: '1',
      } as any,
    });

    expect(result).toEqual({
      ok: true,
      data: {
        transaction: 'abc',
        intent: { chain: 'solana', action: 'transfer' },
        metadata: { chain: 'solana', network: 'mainnet' },
      },
    });
  });

  it('build can include analysis when requested', async () => {
    jest.spyOn(buildService, 'build').mockResolvedValue({
      transaction: 'abc',
      intent: { chain: 'solana', action: 'transfer' } as any,
      metadata: { chain: 'solana', network: 'mainnet' },
    });
    jest.spyOn(analyzeService, 'analyze').mockResolvedValue({
      verdict: 'proceed',
      match: { level: 'full', discrepancies: [] },
      risk: { level: 'low', flags: [] },
      viability: { level: 'viable', issues: [] },
      raw: { feePayer: '', instructions: [], flags: [], summary: '' },
    });

    const result = await controller.build({
      intent: {
        chain: 'solana',
        action: 'transfer',
        from: 'Alice',
        to: 'Bob',
        amount: '1',
      } as any,
      analyze: true,
    });

    expect(result.ok).toBe(true);
    expect((result as any).data.analysis.verdict).toBe('proceed');
  });

  it('rejects analyze when transaction is missing', async () => {
    await expect(controller.analyze({ intent: { chain: 'solana' } as any })).rejects.toThrow(BadRequestException);
  });
});
