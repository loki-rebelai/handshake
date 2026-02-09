import { atom } from 'jotai';
import { PublicKey } from '@solana/web3.js';

export const connectedWalletAtom = atom<PublicKey | null>(null);

export const walletConnectionStatusAtom = atom<'disconnected' | 'connecting' | 'connected'>('disconnected');

export interface WalletBalance {
  sol: number;
  tokens: Array<{
    symbol: string;
    mint: string;
    balance: string;
    decimals: number;
  }>;
}

export const walletBalanceAtom = atom<WalletBalance | null>(null);

export const isLoadingBalanceAtom = atom<boolean>(false);
