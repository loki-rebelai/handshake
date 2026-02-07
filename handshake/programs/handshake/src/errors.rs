use anchor_lang::prelude::*;

#[error_code]
pub enum HandshakeError {
    #[msg("Mathematical overflow occurred")]
    MathOverflow,

    #[msg("Transfer is not in active status")]
    TransferNotActive,

    #[msg("Claim deadline has passed")]
    CannotClaim,

    #[msg("Release conditions not met")]
    ConditionsNotMet,

    #[msg("Invalid condition parameters")]
    InvalidCondition,

    #[msg("Insufficient funds in vault")]
    InsufficientFunds,

    #[msg("Pool is paused")]
    PoolPaused,

    #[msg("Unauthorized action")]
    Unauthorized,

    #[msg("Invalid time window")]
    InvalidTimeWindow,

    #[msg("Deposit amount too small")]
    DepositTooSmall,

    #[msg("Invalid fee configuration")]
    InvalidFeeConfig,

    #[msg("Invalid transfer fee")]
    InvalidTransferFee,

    #[msg("Transfer already claimed")]
    TransferAlreadyClaimed,

    #[msg("Transfer already cancelled")]
    TransferAlreadyCancelled,

    #[msg("Transfer already rejected")]
    TransferAlreadyRejected,

    #[msg("Transfer is expired")]
    TransferExpired,

    #[msg("Only sender can cancel transfer")]
    OnlySenderCanCancel,

    #[msg("Only recipient can claim transfer")]
    OnlyRecipientCanClaim,

    #[msg("Only operator can reject transfer")]
    OnlyOperatorCanReject,

    #[msg("Invalid memo length")]
    InvalidMemoLength,

    #[msg("Claim deadline has not passed")]
    ClaimDeadlineNotPassed,

    #[msg("Calculation error")]
    CalculationError,

    #[msg("Missing required account")]
    MissingAccount,

    #[msg("Invalid mint")]
    InvalidMint,

    #[msg("Pool value is stale and must be updated")]
    StalePoolValue,

    #[msg("Invalid operation for this pool type")]
    InvalidOperation,

    #[msg("Cannot reset pool with outstanding transfers")]
    OutstandingTransfers,

    #[msg("Invalid transfer")]
    InvalidTransfer,

    #[msg("Transfer already declined")]
    TransferAlreadyDeclined,

    #[msg("Only recipient can decline transfer")]
    OnlyRecipientCanDecline,
}
