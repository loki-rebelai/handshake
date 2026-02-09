'use client';

import { useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  connectedWalletAtom,
  walletConnectionStatusAtom,
} from '@/_jotai/wallet/wallet.state';
import { useWalletActions } from '@/_jotai/wallet/wallet.actions';

export function useConnectedWallet() {
  const { publicKey, connecting, connected, disconnect, select } = useWallet();
  const setConnectedWallet = useSetAtom(connectedWalletAtom);
  const setConnectionStatus = useSetAtom(walletConnectionStatusAtom);
  const connectedWallet = useAtomValue(connectedWalletAtom);
  const connectionStatus = useAtomValue(walletConnectionStatusAtom);
  const { fetchBalance } = useWalletActions();

  useEffect(() => {
    if (connecting) {
      setConnectionStatus('connecting');
    } else if (connected && publicKey) {
      setConnectionStatus('connected');
      setConnectedWallet(publicKey);
      fetchBalance(publicKey.toBase58());
    } else {
      setConnectionStatus('disconnected');
      setConnectedWallet(null);
    }
  }, [publicKey, connecting, connected, setConnectedWallet, setConnectionStatus, fetchBalance]);

  return {
    publicKey: connectedWallet,
    isConnected: connectionStatus === 'connected',
    isConnecting: connectionStatus === 'connecting',
    disconnect,
    select,
  };
}
