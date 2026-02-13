'use client';

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';

export type SolanaCluster = 'mainnet-beta' | 'devnet';

interface ClusterConfig {
  rpcUrl: string;
  apiUrl: string;
}

interface ClusterContextValue {
  cluster: SolanaCluster;
  setCluster: (cluster: SolanaCluster) => void;
  rpcUrl: string;
  apiUrl: string;
}

const STORAGE_KEY = 'silkyway-cluster';

const CLUSTER_CONFIGS: Record<SolanaCluster, ClusterConfig> = {
  'mainnet-beta': {
    rpcUrl: process.env.NEXT_PUBLIC_MAINNET_RPC_URL || 'https://api.mainnet-beta.solana.com',
    apiUrl: process.env.NEXT_PUBLIC_MAINNET_API_URL || 'https://api.silkyway.ai',
  },
  devnet: {
    rpcUrl: process.env.NEXT_PUBLIC_DEVNET_RPC_URL || 'https://api.devnet.solana.com',
    apiUrl: process.env.NEXT_PUBLIC_DEVNET_API_URL || 'https://devnet-api.silkyway.ai',
  },
};

function readStoredCluster(): SolanaCluster {
  if (typeof window === 'undefined') return 'mainnet-beta';
  // Check URL params first (for external claim links like ?cluster=devnet)
  const params = new URLSearchParams(window.location.search);
  const urlCluster = params.get('cluster');
  if (urlCluster === 'devnet' || urlCluster === 'mainnet-beta') {
    localStorage.setItem(STORAGE_KEY, urlCluster);
    return urlCluster;
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'mainnet-beta' || stored === 'devnet') return stored;
  return 'mainnet-beta';
}

const ClusterContext = createContext<ClusterContextValue | null>(null);

export function ClusterProvider({ children }: { children: ReactNode }) {
  const [cluster, setClusterState] = useState<SolanaCluster>(readStoredCluster);

  const setCluster = useCallback((c: SolanaCluster) => {
    localStorage.setItem(STORAGE_KEY, c);
    setClusterState(c);
  }, []);

  const value = useMemo(() => {
    const config = CLUSTER_CONFIGS[cluster];
    return { cluster, setCluster, rpcUrl: config.rpcUrl, apiUrl: config.apiUrl };
  }, [cluster, setCluster]);

  return <ClusterContext.Provider value={value}>{children}</ClusterContext.Provider>;
}

export function useCluster(): ClusterContextValue {
  const ctx = useContext(ClusterContext);
  if (!ctx) throw new Error('useCluster must be used within ClusterProvider');
  return ctx;
}
