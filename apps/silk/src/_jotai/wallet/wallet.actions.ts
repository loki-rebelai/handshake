import { useSetAtom } from 'jotai';
import { useCallback } from 'react';
import { api } from '@/lib/api';
import { walletBalanceAtom, isLoadingBalanceAtom } from './wallet.state';

export function useWalletActions() {
  const setBalance = useSetAtom(walletBalanceAtom);
  const setIsLoading = useSetAtom(isLoadingBalanceAtom);

  const fetchBalance = useCallback(
    async (address: string) => {
      setIsLoading(true);
      try {
        const res = await api.get(`/api/wallet/${address}/balance`);
        setBalance(res.data.data);
      } catch {
        setBalance(null);
      } finally {
        setIsLoading(false);
      }
    },
    [setBalance, setIsLoading],
  );

  return { fetchBalance };
}
