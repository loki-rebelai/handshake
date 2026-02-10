import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SdkError } from './errors.js';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'silk');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface WalletEntry {
  label: string;
  address: string;
  privateKey: string;
}

export interface AccountInfo {
  pda: string;
  owner: string;
  mint: string;
  mintDecimals: number;
  operatorIndex: number;
  perTxLimit: number;
  syncedAt: string;
}

export interface HandshakeConfig {
  wallets: WalletEntry[];
  defaultWallet: string;
  preferences: Record<string, unknown>;
  apiUrl?: string;
  account?: AccountInfo;
}

function defaultConfig(): HandshakeConfig {
  return { wallets: [], defaultWallet: 'main', preferences: {} };
}

export function loadConfig(): HandshakeConfig {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw) as HandshakeConfig;
  } catch {
    return defaultConfig();
  }
}

export function saveConfig(config: HandshakeConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export function getWallet(config: HandshakeConfig, label?: string): WalletEntry {
  const target = label || config.defaultWallet;
  const wallet = config.wallets.find((w) => w.label === target);
  if (!wallet) {
    throw new SdkError('WALLET_NOT_FOUND', `Wallet "${target}" not found. Run: silk wallet create`);
  }
  return wallet;
}

export function getApiUrl(config: HandshakeConfig): string {
  return config.apiUrl || process.env.SILK_API_URL || 'https://silkyway.ai';
}
