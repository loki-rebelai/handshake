// Seed constants for PDA derivation
pub const POOL_SEED: &[u8] = b"pool";
pub const SENDER_SEED: &[u8] = b"sender";
pub const RECIPIENT_SEED: &[u8] = b"recipient";
pub const NONCE_SEED: &[u8] = b"nonce";

// Fee precision: 1_000_000 = 100 basis points = 1%
pub const FEE_PRECISION: u64 = 1_000_000;
