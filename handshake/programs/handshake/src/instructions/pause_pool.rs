use anchor_lang::prelude::*;
use crate::{state::*, errors::*, constants::*};

/// Pause or unpause the pool (operator only)
pub fn pause_pool(ctx: Context<PausePool>, is_paused: bool) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    // Validate operator
    require!(
        ctx.accounts.operator.key() == pool.operator,
        HandshakeError::Unauthorized
    );

    pool.is_paused = is_paused;

    emit!(PoolPaused {
        pool: pool.key(),
        is_paused,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct PausePool<'info> {
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
pub struct PoolPaused {
    pub pool: Pubkey,
    pub is_paused: bool,
}
