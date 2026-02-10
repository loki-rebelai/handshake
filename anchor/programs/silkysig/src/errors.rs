use anchor_lang::prelude::*;

#[error_code]
pub enum SilkysigError {
    #[msg("Unauthorized: signer is not owner or operator")]
    Unauthorized,

    #[msg("Transfer exceeds operator per-transaction limit")]
    ExceedsPerTxLimit,

    #[msg("Transfer exceeds operator daily limit")]
    ExceedsDailyLimit,

    #[msg("Account is paused")]
    AccountPaused,

    #[msg("Maximum operators reached")]
    MaxOperatorsReached,

    #[msg("Operator not found")]
    OperatorNotFound,

    #[msg("Operator slot already occupied")]
    OperatorAlreadyExists,

    #[msg("Insufficient token balance")]
    InsufficientBalance,

    #[msg("Mathematical overflow")]
    MathOverflow,
}
