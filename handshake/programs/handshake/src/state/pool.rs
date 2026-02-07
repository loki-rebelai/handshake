use anchor_lang::prelude::*;
use crate::errors::HandshakeError;

#[account]
pub struct Pool {
    /// Version for upgrades
    pub version: u8,

    /// Vault authority (PDA bump)
    pub bump: u8,

    /// Unique pool identifier
    pub pool_id: Pubkey,

    /// Pool operator (can pause, close, withdraw fees)
    pub operator: Pubkey,

    /// Token mint (USDC, USDT, etc.)
    pub mint: Pubkey,

    /// Transfer fee in basis points (0-10000)
    pub transfer_fee_bps: u16,

    /// Cumulative deposits
    pub total_deposits: u64,

    /// Cumulative withdrawals
    pub total_withdrawals: u64,

    /// Current amount held in escrow (total_deposits - total_withdrawals - collected_fees)
    pub total_escrowed: u64,

    /// Statistics
    pub total_transfers_created: u64,
    pub total_transfers_resolved: u64,

    /// Accumulated fees (can be withdrawn by operator)
    pub collected_fees: u64,

    /// Emergency controls
    pub is_paused: bool,
}

impl Pool {
    pub const SPACE: usize = 8 + // discriminator
        1 + // version
        1 + // bump
        32 + // pool_id
        32 + // operator
        32 + // mint
        2 + // transfer_fee_bps
        8 + // total_deposits
        8 + // total_withdrawals
        8 + // total_escrowed
        8 + // total_transfers_created
        8 + // total_transfers_resolved
        8 + // collected_fees
        1; // is_paused

    /// Calculate transfer fee amount
    pub fn calculate_transfer_fee(&self, amount: u64) -> u64 {
        if self.transfer_fee_bps == 0 {
            return 0;
        }
        (amount as u128)
            .checked_mul(self.transfer_fee_bps as u128)
            .unwrap_or(0)
            .checked_div(10000)
            .unwrap_or(0) as u64
    }

    /// Increment transfer created counter
    pub fn increment_transfers_created(&mut self) -> Result<()> {
        self.total_transfers_created = self
            .total_transfers_created
            .checked_add(1)
            .ok_or(HandshakeError::MathOverflow)?;
        Ok(())
    }

    /// Increment transfer resolved counter
    pub fn increment_transfers_resolved(&mut self) -> Result<()> {
        self.total_transfers_resolved = self
            .total_transfers_resolved
            .checked_add(1)
            .ok_or(HandshakeError::MathOverflow)?;
        Ok(())
    }

    /// Add deposit (when creating transfer)
    pub fn add_deposit(&mut self, amount: u64) -> Result<()> {
        self.total_deposits = self
            .total_deposits
            .checked_add(amount)
            .ok_or(HandshakeError::MathOverflow)?;
        self.total_escrowed = self
            .total_escrowed
            .checked_add(amount)
            .ok_or(HandshakeError::MathOverflow)?;
        Ok(())
    }

    /// Add withdrawal (when resolving transfer)
    pub fn add_withdrawal(&mut self, amount: u64) -> Result<()> {
        self.total_withdrawals = self
            .total_withdrawals
            .checked_add(amount)
            .ok_or(HandshakeError::MathOverflow)?;
        self.total_escrowed = self
            .total_escrowed
            .checked_sub(amount)
            .ok_or(HandshakeError::MathOverflow)?;
        Ok(())
    }

    /// Add collected fees
    pub fn add_collected_fees(&mut self, amount: u64) -> Result<()> {
        self.collected_fees = self
            .collected_fees
            .checked_add(amount)
            .ok_or(HandshakeError::MathOverflow)?;
        Ok(())
    }

    /// Reset collected fees to zero (after withdrawal)
    pub fn reset_collected_fees(&mut self) {
        self.collected_fees = 0;
    }

    /// Check if pool has outstanding transfers
    pub fn has_outstanding_transfers(&self) -> bool {
        self.total_transfers_created > self.total_transfers_resolved
    }
}
