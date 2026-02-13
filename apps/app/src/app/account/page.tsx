'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { PublicKey } from '@solana/web3.js';
import { useConnectedWallet } from '@/hooks/useConnectedWallet';
import { useAccountActions } from '@/_jotai/account/account.actions';
import { useTransferActions } from '@/_jotai/transfer/transfer.actions';
import { useSolBalance } from '@/hooks/useSolBalance';
import { SolscanLink } from '@/components/SolscanLink';
import { solscanUrl } from '@/lib/solscan';
import { toast } from 'react-toastify';
import { useCluster } from '@/contexts/ClusterContext';
import { AccountExplainer } from '@/components/AccountExplainer';

const PROGRAM_ID = new PublicKey('SiLKos3MCFggwLsjSeuRiCdcs2MLoJNwq59XwTvEwcS');

type Tab = 'deposit' | 'withdraw' | 'operators' | 'settings';

const TABS: { key: Tab; label: string }[] = [
  { key: 'deposit', label: 'Deposit' },
  { key: 'withdraw', label: 'Withdraw' },
  { key: 'operators', label: 'Operators' },
  { key: 'settings', label: 'Settings' },
];

function formatAmount(raw: string | number, decimals: number) {
  return (Number(raw) / 10 ** decimals).toFixed(2);
}

interface AccountData {
  pda: string;
  owner: string;
  mint: string;
  mintDecimals: number;
  isPaused: boolean;
  balance: number;
  operators: Array<{
    index: number;
    pubkey: string;
    perTxLimit: string;
  }>;
}

export default function AccountDashboardPage() {
  const router = useRouter();
  const { publicKey, isConnected } = useConnectedWallet();
  const {
    fetchAccount,
    depositToAccount,
    transferFromAccount,
    togglePause,
    addOperator,
    removeOperator,
    closeAccount,
    signAndSubmit,
    transferSol,
  } = useAccountActions();
  const { requestFaucet } = useTransferActions();
  const { cluster } = useCluster();
  const { balances, fetchMultipleBalances } = useSolBalance();

  const [account, setAccount] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('deposit');

  // Deposit state
  const [depositAmount, setDepositAmount] = useState('');
  const [depositLoading, setDepositLoading] = useState(false);
  const [faucetLoading, setFaucetLoading] = useState(false);

  // Withdraw state
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawLoading, setWithdrawLoading] = useState(false);

  // Operator state
  const [newOperator, setNewOperator] = useState('');
  const [newPerTxLimit, setNewPerTxLimit] = useState('5');
  const [addOpLoading, setAddOpLoading] = useState(false);
  const [removeOpLoading, setRemoveOpLoading] = useState<string | null>(null);
  const [fundingOperator, setFundingOperator] = useState<string | null>(null);
  const [fundSolAmount, setFundSolAmount] = useState('0.1');
  const [isFundingSol, setIsFundingSol] = useState(false);

  // Settings state
  const [pauseLoading, setPauseLoading] = useState(false);
  const [closeLoading, setCloseLoading] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const walletAddress = publicKey?.toBase58() ?? '';

  const loadAccount = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    try {
      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from('account'), publicKey.toBuffer()],
        PROGRAM_ID,
      );
      const data = await fetchAccount(pda.toBase58());
      setAccount(data);

      // Fetch SOL balances for all operators
      if (data.operators.length > 0) {
        const operatorPubkeys = data.operators.map((op: { pubkey: string }) => op.pubkey);
        await fetchMultipleBalances(operatorPubkeys);
      }
    } catch {
      setAccount(null);
    } finally {
      setLoading(false);
    }
  }, [publicKey, fetchAccount, fetchMultipleBalances]);

  useEffect(() => {
    if (isConnected) {
      loadAccount();
    }
  }, [isConnected, loadAccount, cluster]);

  // ── Deposit handlers ──

  const handleGetUsdc = async () => {
    if (!walletAddress) return;
    setFaucetLoading(true);
    try {
      await requestFaucet(walletAddress, 'usdc');
      toast.success('Devnet USDC received!');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Faucet request failed');
    } finally {
      setFaucetLoading(false);
    }
  };

  const handleDeposit = async () => {
    if (!walletAddress || !account) return;
    const amt = parseFloat(depositAmount) || 0;
    if (amt <= 0) return;
    setDepositLoading(true);
    try {
      const { transaction } = await depositToAccount({
        depositor: walletAddress,
        accountPda: account.pda,
        amount: amt * 10 ** account.mintDecimals,
      });
      toast.info('Please approve the transaction in your wallet...');
      const txid = await signAndSubmit(transaction);
      toast.success(
        <span>Deposited! TX: <a href={solscanUrl(txid, 'tx')} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-solar-gold">{txid.slice(0, 8)}...</a></span>,
      );
      setDepositAmount('');
      await loadAccount();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Deposit failed');
    } finally {
      setDepositLoading(false);
    }
  };

  // ── Withdraw handlers ──

  const handleWithdraw = async () => {
    if (!walletAddress || !account) return;
    const amt = parseFloat(withdrawAmount) || 0;
    if (amt <= 0) return;
    setWithdrawLoading(true);
    try {
      const { transaction } = await transferFromAccount({
        signer: walletAddress,
        accountPda: account.pda,
        recipient: walletAddress,
        amount: amt * 10 ** account.mintDecimals,
      });
      toast.info('Please approve the transaction in your wallet...');
      const txid = await signAndSubmit(transaction);
      toast.success(
        <span>Withdrawn! TX: <a href={solscanUrl(txid, 'tx')} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-solar-gold">{txid.slice(0, 8)}...</a></span>,
      );
      setWithdrawAmount('');
      await loadAccount();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Withdrawal failed');
    } finally {
      setWithdrawLoading(false);
    }
  };

  // ── Operator handlers ──

  const handleAddOperator = async () => {
    if (!account) return;
    const limitNum = parseFloat(newPerTxLimit) || 0;
    if (!newOperator || limitNum < 0) return;
    try {
      new PublicKey(newOperator);
    } catch {
      toast.error('Invalid operator public key');
      return;
    }
    setAddOpLoading(true);
    try {
      const { transaction } = await addOperator({
        owner: walletAddress,
        accountPda: account.pda,
        operator: newOperator,
        perTxLimit: limitNum * 10 ** account.mintDecimals,
      });
      toast.info('Please approve the transaction in your wallet...');
      await signAndSubmit(transaction);
      toast.success('Operator added');
      setNewOperator('');
      setNewPerTxLimit('5');
      await loadAccount();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to add operator');
    } finally {
      setAddOpLoading(false);
    }
  };

  const handleRemoveOperator = async (operatorPubkey: string) => {
    if (!account) return;
    setRemoveOpLoading(operatorPubkey);
    try {
      const { transaction } = await removeOperator({
        owner: walletAddress,
        accountPda: account.pda,
        operator: operatorPubkey,
      });
      toast.info('Please approve the transaction in your wallet...');
      await signAndSubmit(transaction);
      toast.success('Operator removed');
      await loadAccount();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove operator');
    } finally {
      setRemoveOpLoading(null);
    }
  };

  const handleFundOperator = async (operatorPubkey: string) => {
    if (!walletAddress) return;
    const solAmount = parseFloat(fundSolAmount) || 0;
    if (solAmount <= 0) {
      toast.error('Please enter a valid SOL amount');
      return;
    }

    setIsFundingSol(true);
    try {
      const txid = await transferSol({
        from: walletAddress,
        to: operatorPubkey,
        amountSol: solAmount,
      });
      toast.success(
        <span>Sent ◎{solAmount} SOL! TX: <a href={solscanUrl(txid, 'tx')} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-solar-gold">{txid.slice(0, 8)}...</a></span>,
      );
      setFundingOperator(null);
      setFundSolAmount('0.1');
      await loadAccount(); // Refresh balances
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to send SOL');
    } finally {
      setIsFundingSol(false);
    }
  };

  // ── Settings handlers ──

  const handleTogglePause = async () => {
    if (!account) return;
    setPauseLoading(true);
    try {
      const { transaction } = await togglePause({ owner: walletAddress, accountPda: account.pda });
      toast.info('Please approve the transaction in your wallet...');
      await signAndSubmit(transaction);
      toast.success(account.isPaused ? 'Account resumed' : 'Account paused');
      await loadAccount();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to toggle pause');
    } finally {
      setPauseLoading(false);
    }
  };

  const handleCloseAccount = async () => {
    if (!account) return;
    setCloseLoading(true);
    try {
      const { transaction } = await closeAccount({ owner: walletAddress, accountPda: account.pda });
      toast.info('Please approve the transaction in your wallet...');
      await signAndSubmit(transaction);
      toast.success('Account closed — tokens swept to your wallet');
      setShowCloseConfirm(false);
      setTimeout(() => router.push('/'), 1500);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to close account');
    } finally {
      setCloseLoading(false);
    }
  };

  // ── Render gates ──

  if (!isConnected) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-[1200px] items-center justify-center px-8">
        <p className="text-[0.85rem] text-star-white/40">Connect your wallet to view your account.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-[1200px] items-center justify-center px-8">
        <p className="text-[0.85rem] text-star-white/40">Loading account...</p>
      </div>
    );
  }

  if (!account) return <AccountExplainer />;

  return (
    <div className="mx-auto max-w-xl px-8 py-10">
      {/* Hero Card */}
      <div
        className="gradient-border-top mb-6 border border-nebula-purple/20 p-6"
        style={{ background: 'linear-gradient(180deg, rgba(168, 85, 247, 0.04) 0%, rgba(12, 0, 21, 0.8) 100%)' }}
      >
        <div className="text-[0.7rem] uppercase tracking-[0.15em] text-star-white/50">
          Silk Account
        </div>
        <div className="mt-3 font-display text-3xl font-black text-star-white">
          ${formatAmount(account.balance, account.mintDecimals)}
          <span className="ml-2 text-base font-normal text-star-white/30">USDC</span>
        </div>
        <div className="mt-5 space-y-2">
          <div className="flex items-center justify-between text-[0.8rem]">
            <span className="text-star-white/50">Account</span>
            <SolscanLink address={account.pda} type="account" />
          </div>
          <div className="flex items-center justify-between text-[0.8rem]">
            <span className="text-star-white/50">Owner</span>
            <SolscanLink address={account.owner} type="account" />
          </div>
          <div className="flex items-center justify-between text-[0.8rem]">
            <span className="text-star-white/50">Status</span>
            {account.isPaused ? (
              <span className="border border-red-400/30 bg-red-400/10 px-2 py-0.5 text-[0.7rem] font-medium uppercase tracking-[0.1em] text-red-400">
                Paused
              </span>
            ) : (
              <span className="border border-green-400/30 bg-green-400/10 px-2 py-0.5 text-[0.7rem] font-medium uppercase tracking-[0.1em] text-green-400">
                Active
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="mb-6 flex border-b border-nebula-purple/15">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-[0.75rem] font-medium uppercase tracking-[0.15em] transition-colors ${
              tab === key
                ? 'border-b-2 border-solar-gold text-solar-gold'
                : 'text-star-white/40 hover:text-star-white/70'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab Panels */}
      <div
        className="border border-nebula-purple/20 p-6"
        style={{ background: 'linear-gradient(180deg, rgba(168, 85, 247, 0.04) 0%, rgba(12, 0, 21, 0.8) 100%)' }}
      >
        {/* ── Deposit Tab ── */}
        {tab === 'deposit' && (
          <div className="space-y-5">
            <h2 className="mb-5 text-[0.85rem] font-medium uppercase tracking-[0.2em] text-solar-gold">
              Deposit
            </h2>

            {cluster === 'devnet' && (
              <button
                onClick={handleGetUsdc}
                disabled={faucetLoading}
                className="h-10 w-full border border-nebula-purple/30 bg-nebula-purple/10 text-[0.8rem] font-medium uppercase tracking-[0.15em] text-nebula-purple transition-all hover:border-nebula-purple/50 hover:bg-nebula-purple/18 disabled:opacity-30"
              >
                {faucetLoading ? 'Requesting...' : 'Get Devnet USDC'}
              </button>
            )}

            <div className="space-y-1.5">
              <label htmlFor="depositAmount" className="block text-[0.7rem] uppercase tracking-[0.15em] text-star-white/50">
                Deposit amount
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[0.8rem] text-star-white/30">$</span>
                <input
                  id="depositAmount"
                  type="number"
                  step="any"
                  min="0"
                  placeholder="0.00"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="w-full border border-nebula-purple/20 bg-deep-space/80 py-2.5 pl-7 pr-3 text-[0.8rem] text-star-white placeholder:text-star-white/15 transition-colors focus:border-solar-gold/30 focus:outline-none"
                />
              </div>
            </div>

            <button
              onClick={handleDeposit}
              disabled={depositLoading || (parseFloat(depositAmount) || 0) <= 0}
              className="h-10 w-full border border-solar-gold/30 bg-solar-gold/10 text-[0.8rem] font-medium uppercase tracking-[0.15em] text-solar-gold transition-all hover:border-solar-gold/50 hover:bg-solar-gold/18 hover:shadow-[0_0_20px_rgba(251,191,36,0.15)] disabled:opacity-30 disabled:hover:shadow-none"
            >
              {depositLoading ? 'Depositing...' : 'Deposit'}
            </button>
          </div>
        )}

        {/* ── Withdraw Tab ── */}
        {tab === 'withdraw' && (
          <div className="space-y-5">
            <h2 className="mb-5 text-[0.85rem] font-medium uppercase tracking-[0.2em] text-solar-gold">
              Withdraw
            </h2>

            <div className="space-y-1.5">
              <label htmlFor="withdrawAmount" className="block text-[0.7rem] uppercase tracking-[0.15em] text-star-white/50">
                Withdraw amount
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[0.8rem] text-star-white/30">$</span>
                <input
                  id="withdrawAmount"
                  type="number"
                  step="any"
                  min="0"
                  placeholder="0.00"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  className="w-full border border-nebula-purple/20 bg-deep-space/80 py-2.5 pl-7 pr-3 text-[0.8rem] text-star-white placeholder:text-star-white/15 transition-colors focus:border-solar-gold/30 focus:outline-none"
                />
              </div>
            </div>

            <button
              onClick={handleWithdraw}
              disabled={withdrawLoading || (parseFloat(withdrawAmount) || 0) <= 0}
              className="h-10 w-full border border-solar-gold/30 bg-solar-gold/10 text-[0.8rem] font-medium uppercase tracking-[0.15em] text-solar-gold transition-all hover:border-solar-gold/50 hover:bg-solar-gold/18 hover:shadow-[0_0_20px_rgba(251,191,36,0.15)] disabled:opacity-30 disabled:hover:shadow-none"
            >
              {withdrawLoading ? 'Withdrawing...' : 'Withdraw to Wallet'}
            </button>
          </div>
        )}

        {/* ── Operators Tab ── */}
        {tab === 'operators' && (
          <div className="space-y-5">
            <h2 className="mb-5 text-[0.85rem] font-medium uppercase tracking-[0.2em] text-solar-gold">
              Operators
            </h2>

            {account.operators.length === 0 ? (
              <div className="space-y-4">
                <p className="text-[0.85rem] text-star-white/40">No agents authorized yet.</p>
                <div className="border-l-2 border-nebula-purple bg-nebula-purple/[0.04] p-4 space-y-2">
                  <p className="text-[0.8rem] font-medium text-nebula-purple">What are agents?</p>
                  <p className="text-[0.75rem] text-star-white/40">
                    Agents can make payments on your behalf with spending limits you control.
                  </p>
                  <p className="text-[0.75rem] text-star-white/40">
                    Perfect for subscriptions, automated transfers, and AI agent operations.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {account.operators.map((op) => (
                  <div key={op.pubkey}>
                    <div className="flex items-center justify-between border border-nebula-purple/15 bg-deep-space/80 px-3 py-2.5">
                      <div className="flex items-center gap-3 text-[0.75rem]">
                        <SolscanLink address={op.pubkey} type="account" />
                        <span className="text-star-white/40">|</span>
                        <span className="text-star-white/40">
                          ${formatAmount(op.perTxLimit, account.mintDecimals)}/tx
                        </span>
                        <span className="text-star-white/40">|</span>
                        <span className="text-star-white/60">
                          ◎{(balances[op.pubkey] ?? 0).toFixed(4)} SOL
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setFundingOperator(fundingOperator === op.pubkey ? null : op.pubkey)}
                          className="text-[0.7rem] font-medium uppercase tracking-[0.15em] text-nebula-purple transition-colors hover:text-nebula-purple/70"
                        >
                          {fundingOperator === op.pubkey ? 'Cancel' : 'Fund'}
                        </button>
                        <button
                          onClick={() => handleRemoveOperator(op.pubkey)}
                          disabled={removeOpLoading === op.pubkey}
                          className="text-[0.7rem] font-medium uppercase tracking-[0.15em] text-red-400 transition-colors hover:text-red-300 disabled:opacity-30"
                        >
                          {removeOpLoading === op.pubkey ? 'Removing...' : 'Remove'}
                        </button>
                      </div>
                    </div>

                    {fundingOperator === op.pubkey && (
                      <div className="border border-t-0 border-nebula-purple/15 bg-deep-space/60 px-3 py-3">
                        <div className="flex items-end gap-2">
                          <div className="flex-1 space-y-1">
                            <label className="block text-[0.7rem] uppercase tracking-[0.15em] text-star-white/50">
                              SOL amount
                            </label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[0.8rem] text-star-white/30">◎</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={fundSolAmount}
                                onChange={(e) => setFundSolAmount(e.target.value)}
                                className="w-full border border-nebula-purple/20 bg-deep-space/80 py-2 pl-7 pr-3 text-[0.8rem] text-star-white placeholder:text-star-white/15 transition-colors focus:border-solar-gold/30 focus:outline-none"
                              />
                            </div>
                          </div>
                          <button
                            onClick={() => handleFundOperator(op.pubkey)}
                            disabled={isFundingSol}
                            className="h-9 border border-nebula-purple/30 bg-nebula-purple/10 px-4 text-[0.75rem] font-medium uppercase tracking-[0.15em] text-nebula-purple transition-all hover:border-nebula-purple/50 hover:bg-nebula-purple/18 disabled:opacity-30"
                          >
                            {isFundingSol ? 'Sending...' : 'Send SOL'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-3 border-t border-nebula-purple/15 pt-4">
              <h3 className="text-[0.75rem] font-medium uppercase tracking-[0.15em] text-star-white/50">
                Add Operator
              </h3>
              <div className="space-y-1.5">
                <label className="block text-[0.7rem] uppercase tracking-[0.15em] text-star-white/50">
                  Operator public key
                </label>
                <input
                  type="text"
                  value={newOperator}
                  onChange={(e) => setNewOperator(e.target.value)}
                  placeholder="Pubkey..."
                  className="w-full border border-nebula-purple/20 bg-deep-space/80 px-3 py-2.5 text-[0.8rem] text-star-white placeholder:text-star-white/15 transition-colors focus:border-solar-gold/30 focus:outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-[0.7rem] uppercase tracking-[0.15em] text-star-white/50">
                  Per-transaction limit
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[0.8rem] text-star-white/30">$</span>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={newPerTxLimit}
                    onChange={(e) => setNewPerTxLimit(e.target.value)}
                    className="w-full border border-nebula-purple/20 bg-deep-space/80 py-2.5 pl-7 pr-3 text-[0.8rem] text-star-white placeholder:text-star-white/15 transition-colors focus:border-solar-gold/30 focus:outline-none"
                  />
                </div>
              </div>
              <button
                onClick={handleAddOperator}
                disabled={addOpLoading || !newOperator}
                className="h-10 w-full border border-solar-gold/30 bg-solar-gold/10 text-[0.8rem] font-medium uppercase tracking-[0.15em] text-solar-gold transition-all hover:border-solar-gold/50 hover:bg-solar-gold/18 hover:shadow-[0_0_20px_rgba(251,191,36,0.15)] disabled:opacity-30 disabled:hover:shadow-none"
              >
                {addOpLoading ? 'Adding...' : 'Add Operator'}
              </button>
            </div>
          </div>
        )}

        {/* ── Settings Tab ── */}
        {tab === 'settings' && (
          <div className="space-y-6">
            <div>
              <h2 className="mb-5 text-[0.85rem] font-medium uppercase tracking-[0.2em] text-solar-gold">
                Account Status
              </h2>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-[0.8rem] text-star-white/50">Status</span>
                  {account.isPaused ? (
                    <span className="border border-red-400/30 bg-red-400/10 px-2 py-0.5 text-[0.7rem] font-medium uppercase tracking-[0.1em] text-red-400">
                      Paused
                    </span>
                  ) : (
                    <span className="border border-green-400/30 bg-green-400/10 px-2 py-0.5 text-[0.7rem] font-medium uppercase tracking-[0.1em] text-green-400">
                      Active
                    </span>
                  )}
                </div>
                <button
                  onClick={handleTogglePause}
                  disabled={pauseLoading}
                  className="h-9 border border-nebula-purple/30 bg-nebula-purple/10 px-4 text-[0.75rem] font-medium uppercase tracking-[0.15em] text-nebula-purple transition-all hover:border-nebula-purple/50 hover:bg-nebula-purple/18 disabled:opacity-30"
                >
                  {pauseLoading ? 'Processing...' : account.isPaused ? 'Resume Account' : 'Pause Account'}
                </button>
              </div>
            </div>

            <div className="border-t border-nebula-purple/15 pt-6">
              <h2 className="mb-3 text-[0.85rem] font-medium uppercase tracking-[0.2em] text-red-400">
                Danger Zone
              </h2>
              <p className="mb-4 text-[0.8rem] text-star-white/40">
                Closing your account will sweep all remaining tokens to your wallet and permanently delete the account.
              </p>
              <button
                onClick={() => setShowCloseConfirm(true)}
                className="h-10 w-full border border-red-400/30 bg-red-400/10 text-[0.8rem] font-medium uppercase tracking-[0.15em] text-red-400 transition-all hover:border-red-400/50 hover:bg-red-400/18"
              >
                Close Account
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Close Confirmation Overlay */}
      {showCloseConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md border border-red-400/20 bg-deep-space p-6">
            <h3 className="mb-3 text-[0.85rem] font-medium uppercase tracking-[0.2em] text-red-400">
              Confirm Close Account
            </h3>
            <p className="mb-6 text-[0.8rem] text-star-white/50">
              This will sweep all tokens to your wallet and permanently close the account. This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowCloseConfirm(false)}
                disabled={closeLoading}
                className="h-10 flex-1 border border-nebula-purple/20 bg-transparent text-[0.8rem] font-medium uppercase tracking-[0.15em] text-star-white/50 transition-all hover:border-nebula-purple/40 hover:text-star-white/70"
              >
                Cancel
              </button>
              <button
                onClick={handleCloseAccount}
                disabled={closeLoading}
                className="h-10 flex-1 border border-red-400/30 bg-red-400/10 text-[0.8rem] font-medium uppercase tracking-[0.15em] text-red-400 transition-all hover:border-red-400/50 hover:bg-red-400/18 disabled:opacity-30"
              >
                {closeLoading ? 'Closing...' : 'Confirm Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
