use anchor_lang::prelude::*;
use crate::{state::*, errors::*, constants::*};

/// Reset pool counters (operator only, requires no outstanding transfers)
pub fn reset_pool(ctx: Context<ResetPool>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    // Validate operator
    require!(
        ctx.accounts.operator.key() == pool.operator,
        HandshakeError::Unauthorized
    );

    // Validate no outstanding transfers
    require!(
        !pool.has_outstanding_transfers(),
        HandshakeError::OutstandingTransfers
    );

    // Reset counters
    pool.total_deposits = 0;
    pool.total_withdrawals = 0;
    pool.total_escrowed = 0;
    pool.total_transfers_created = 0;
    pool.total_transfers_resolved = 0;
    pool.collected_fees = 0;

    emit!(PoolReset {
        pool: pool.key(),
    });

    Ok(())
}

#[derive(Accounts)]
pub struct ResetPool<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,

    #[account(
        mut,
        seeds = [
            POOL_SEED,
            pool.pool_id.as_ref()
        ],
        bump = pool.bump
    )]
    pub pool: Box<Account<'info, Pool>>,
}

#[event]
pub struct PoolReset {
    pub pool: Pubkey,
}
