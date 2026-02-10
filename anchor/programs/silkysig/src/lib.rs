use anchor_lang::prelude::*;

mod constants;
mod errors;
mod instructions;
mod state;

use instructions::*;
use state::*;

declare_id!("8MDFar9moBycSXb6gdZgqkiSEGRBRkzxa7JPLddqYcKs");

#[program]
pub mod silkysig {
    use super::*;

    pub fn create_account(
        ctx: Context<CreateAccount>,
        operator: Option<Pubkey>,
        per_tx_limit: Option<u64>,
    ) -> Result<()> {
        instructions::create_account(ctx, operator, per_tx_limit)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit(ctx, amount)
    }

    pub fn transfer_from_account<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, TransferFromAccount<'info>>,
        amount: u64,
    ) -> Result<()> {
        instructions::transfer_from_account(ctx, amount)
    }
}
