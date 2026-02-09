import { useSetAtom } from 'jotai';
import { useCallback } from 'react';
import { VersionedTransaction } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';
import { api } from '@/lib/api';
import { transfersAtom, isLoadingTransfersAtom } from './transfer.state';

export function useTransferActions() {
  const setTransfers = useSetAtom(transfersAtom);
  const setIsLoading = useSetAtom(isLoadingTransfersAtom);
  const { signTransaction } = useWallet();

  const fetchTransfers = useCallback(
    async (wallet: string) => {
      setIsLoading(true);
      try {
        const res = await api.get('/api/transfers', { params: { wallet } });
        setTransfers(res.data.data.transfers);
      } catch {
        setTransfers([]);
      } finally {
        setIsLoading(false);
      }
    },
    [setTransfers, setIsLoading],
  );

  const signAndSubmit = useCallback(
    async (base64Tx: string): Promise<string> => {
      if (!signTransaction) throw new Error('Wallet does not support signing');
      const txBytes = Buffer.from(base64Tx, 'base64');
      const tx = VersionedTransaction.deserialize(txBytes);
      const signed = await signTransaction(tx);
      const signedBase64 = Buffer.from(signed.serialize()).toString('base64');
      const res = await api.post('/api/tx/submit', { signedTx: signedBase64 });
      return res.data.data.txid;
    },
    [signTransaction],
  );

  const createTransfer = useCallback(
    async (params: {
      sender: string;
      recipient: string;
      amount: number;
      token?: string;
      memo?: string;
    }) => {
      const res = await api.post('/api/tx/create-transfer', params);
      return res.data.data as { transaction: string; transferPda: string };
    },
    [],
  );

  const claimTransfer = useCallback(async (claimer: string, transferPda: string) => {
    const res = await api.post('/api/tx/claim-transfer', { claimer, transferPda });
    return res.data.data as { transaction: string };
  }, []);

  const cancelTransfer = useCallback(async (canceller: string, transferPda: string) => {
    const res = await api.post('/api/tx/cancel-transfer', { canceller, transferPda });
    return res.data.data as { transaction: string };
  }, []);

  const requestFaucet = useCallback(async (wallet: string, token?: string) => {
    const res = await api.post('/api/tx/faucet', { wallet, token: token || 'both' });
    return res.data.data;
  }, []);

  return {
    fetchTransfers,
    signAndSubmit,
    createTransfer,
    claimTransfer,
    cancelTransfer,
    requestFaucet,
  };
}
