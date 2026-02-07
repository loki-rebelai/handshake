use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};
use crate::{state::*, errors::*, constants::*};

/// Initialize a new escrow pool for a specific token
pub fn init_pool(
    ctx: Context<InitPool>,
    pool_id: Pubkey,
    transfer_fee_bps: u16,
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let clock = Clock::get()?;

    // Validate fee configuration
    require!(
        transfer_fee_bps <= 10000,
        HandshakeError::InvalidTransferFee
    );

    // Initialize pool account
    pool.version = 1;
    pool.bump = ctx.bumps.pool;
    pool.pool_id = pool_id;
    pool.operator = ctx.accounts.operator.key();
    pool.mint = ctx.accounts.mint.key();
    pool.transfer_fee_bps = transfer_fee_bps;

    // Initialize tracking
    pool.total_deposits = 0;
    pool.total_withdrawals = 0;
    pool.total_escrowed = 0;
    pool.total_transfers_created = 0;
    pool.total_transfers_resolved = 0;
    pool.collected_fees = 0;
    pool.is_paused = false;

    emit!(PoolCreated {
        pool: pool.key(),
        pool_id,
        operator: pool.operator,
        mint: pool.mint,
        transfer_fee_bps,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(pool_id: Pubkey, transfer_fee_bps: u16)]
pub struct InitPool<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,

    /// The token mint this pool will handle
    pub mint: InterfaceAccount<'info, Mint>,

    /// Pool account - PDA derived from pool_id
    #[account(
        init,
        payer = operator,
        space = Pool::SPACE,
        seeds = [
            POOL_SEED,
            pool_id.as_ref()
        ],
        bump
    )]
    pub pool: Box<Account<'info, Pool>>,

    /// Pool's token account - where escrowed funds are stored
    #[account(
        init,
        payer = operator,
        associated_token::mint = mint,
        associated_token::authority = pool,
        associated_token::token_program = token_program
    )]
    pub pool_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

/// Event emitted when a new pool is initialized
#[event]
pub struct PoolCreated {
    pub pool: Pubkey,
    pub pool_id: Pubkey,
    pub operator: Pubkey,
    pub mint: Pubkey,
    pub transfer_fee_bps: u16,
}
