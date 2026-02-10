use anchor_lang::prelude::*;

pub const MAX_OPERATORS: usize = 3;

#[account]
pub struct SilkAccount {
    /// Version for future upgrades
    pub version: u8,

    /// PDA bump
    pub bump: u8,

    /// Account owner (human) — full control, bypasses all policies
    pub owner: Pubkey,

    /// Token mint this account holds
    pub mint: Pubkey,

    /// Circuit breaker — paused accounts block all operator transfers
    pub is_paused: bool,

    /// Number of active operators (0-3)
    pub operator_count: u8,

    /// Operator slots — each with independent policy
    pub operators: [OperatorSlot; MAX_OPERATORS],
}

impl SilkAccount {
    pub const SPACE: usize = 8  // discriminator
        + 1                     // version
        + 1                     // bump
        + 32                    // owner
        + 32                    // mint
        + 1                     // is_paused
        + 1                     // operator_count
        + (MAX_OPERATORS * OperatorSlot::SPACE); // operators

    /// Find the operator slot index for a given pubkey.
    /// Returns None if the pubkey is not an active operator.
    pub fn find_operator(&self, pubkey: &Pubkey) -> Option<usize> {
        for i in 0..self.operator_count as usize {
            if self.operators[i].pubkey == *pubkey {
                return Some(i);
            }
        }
        None
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct OperatorSlot {
    /// Operator public key (Pubkey::default() = empty slot)
    pub pubkey: Pubkey,

    /// Max amount per transaction in token smallest units (0 = no limit)
    pub per_tx_limit: u64,

    /// Max amount per day in token smallest units (0 = no limit, not enforced yet)
    pub daily_limit: u64,

    /// Tracks daily spend (for future enforcement)
    pub daily_spent: u64,

    /// Timestamp of last daily reset (for future enforcement)
    pub last_reset: i64,
}

impl OperatorSlot {
    pub const SPACE: usize = 32  // pubkey
        + 8                      // per_tx_limit
        + 8                      // daily_limit
        + 8                      // daily_spent
        + 8;                     // last_reset
}
