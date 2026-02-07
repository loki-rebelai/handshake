use anchor_lang::prelude::*;
use crate::errors::HandshakeError;

#[account]
pub struct SecureTransfer {
    /// Version for upgrades
    pub version: u8,

    /// PDA bump
    pub bump: u8,

    /// Client-provided nonce
    pub nonce: u64,

    /// Participants
    pub sender: Pubkey,
    pub recipient: Pubkey,

    /// Pool this transfer belongs to
    pub pool: Pubkey,

    /// Escrowed amount (in tokens)
    pub amount: u64,

    /// Timestamps
    pub created_at: i64,
    pub claimable_after: i64,  // When recipient can start claiming (0 = immediate)
    pub claimable_until: i64,  // When recipient must claim by (0 = no deadline)

    /// Status
    pub status: TransferStatus,

    /// Optional release conditions
    pub release_conditions: Option<ReleaseConditions>,

    /// Metadata - fixed size memo
    pub memo: [u8; 64],

    /// Travel rule compliance data hash
    pub compliance_hash: Option<[u8; 32]>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Debug)]
pub enum TransferStatus {
    Active,
    Claimed,
    Cancelled,
    Rejected,
    Expired,
    Declined,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ReleaseConditions {
    pub condition_type: ConditionType,
    pub params: [u8; 64], // Flexible params based on condition type
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum ConditionType {
    TimeDelay,      // Release after specific timestamp
    MultiSig,       // Require M of N signatures
    Oracle,         // External oracle confirmation
    Milestone,      // External milestone verification
}

impl SecureTransfer {
    pub const SPACE: usize = 8 + // discriminator
        1 + // version
        1 + // bump
        8 + // nonce
        32 + // sender
        32 + // recipient
        32 + // pool
        8 + // amount
        8 + // created_at
        8 + // claimable_after
        8 + // claimable_until
        1 + // status enum
        (1 + (1 + 64)) + // release_conditions Option
        64 + // memo
        (1 + 32); // compliance_hash Option

    /// Initialize a new transfer
    pub fn initialize(
        &mut self,
        bump: u8,
        nonce: u64,
        sender: Pubkey,
        recipient: Pubkey,
        pool: Pubkey,
        amount: u64,
        memo: String,
        claimable_after: i64,
        claimable_until: i64,
    ) -> Result<()> {
        let clock = Clock::get()?;

        // Validate memo length
        require!(memo.len() <= 64, HandshakeError::InvalidMemoLength);

        // Validate claim window makes sense
        if claimable_after > 0 && claimable_until > 0 {
            require!(
                claimable_after < claimable_until,
                HandshakeError::InvalidTimeWindow
            );
        }

        // Validate timestamps are not in the past (unless 0)
        if claimable_after > 0 {
            require!(
                claimable_after >= clock.unix_timestamp,
                HandshakeError::InvalidTimeWindow
            );
        }

        if claimable_until > 0 {
            require!(
                claimable_until >= clock.unix_timestamp,
                HandshakeError::InvalidTimeWindow
            );
        }

        self.version = 1;
        self.bump = bump;
        self.nonce = nonce;
        self.sender = sender;
        self.recipient = recipient;
        self.pool = pool;
        self.amount = amount;
        self.created_at = clock.unix_timestamp;
        self.claimable_after = claimable_after;
        self.claimable_until = claimable_until;
        self.status = TransferStatus::Active;
        self.release_conditions = None;
        self.compliance_hash = None;

        // Convert memo to fixed-size array
        let mut memo_bytes = [0u8; 64];
        let memo_str_bytes = memo.as_bytes();
        let copy_len = memo_str_bytes.len().min(64);
        memo_bytes[..copy_len].copy_from_slice(&memo_str_bytes[..copy_len]);
        self.memo = memo_bytes;

        Ok(())
    }

    /// Validate that transfer is active
    pub fn validate_active(&self) -> Result<()> {
        require!(
            self.status == TransferStatus::Active,
            HandshakeError::TransferNotActive
        );
        Ok(())
    }

    /// Validate claim window (claimable_after to claimable_until)
    pub fn validate_claim_window(&self) -> Result<()> {
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;

        // Check claimable_after (0 means no restriction)
        if self.claimable_after > 0 {
            require!(now >= self.claimable_after, HandshakeError::CannotClaim);
        }

        // Check claimable_until (0 means no restriction)
        if self.claimable_until > 0 {
            require!(now <= self.claimable_until, HandshakeError::CannotClaim);
        }

        Ok(())
    }

    /// Check if transfer is expired
    pub fn is_expired(&self) -> Result<bool> {
        let clock = Clock::get()?;
        Ok(self.claimable_until > 0 && clock.unix_timestamp > self.claimable_until)
    }

    /// Validate sender can cancel
    pub fn validate_sender_can_cancel(&self, sender: Pubkey) -> Result<()> {
        require!(
            self.sender == sender,
            HandshakeError::OnlySenderCanCancel
        );
        self.validate_active()?;
        Ok(())
    }

    /// Validate recipient can claim
    pub fn validate_recipient_can_claim(&self, recipient: Pubkey) -> Result<()> {
        require!(
            self.recipient == recipient,
            HandshakeError::OnlyRecipientCanClaim
        );
        self.validate_active()?;
        self.validate_claim_window()?;
        Ok(())
    }

    /// Mark as claimed
    pub fn mark_as_claimed(&mut self) -> Result<()> {
        self.validate_active()?;
        self.status = TransferStatus::Claimed;
        Ok(())
    }

    /// Mark as cancelled
    pub fn mark_as_cancelled(&mut self) -> Result<()> {
        self.validate_active()?;
        self.status = TransferStatus::Cancelled;
        Ok(())
    }

    /// Mark as rejected
    pub fn mark_as_rejected(&mut self) -> Result<()> {
        self.validate_active()?;
        self.status = TransferStatus::Rejected;
        Ok(())
    }

    /// Mark as expired
    pub fn mark_as_expired(&mut self) -> Result<()> {
        self.validate_active()?;
        self.status = TransferStatus::Expired;
        Ok(())
    }

    /// Mark as declined
    pub fn mark_as_declined(&mut self) -> Result<()> {
        self.validate_active()?;
        self.status = TransferStatus::Declined;
        Ok(())
    }
}
