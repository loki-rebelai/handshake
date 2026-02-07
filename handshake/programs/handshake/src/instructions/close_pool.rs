use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, TransferChecked, Mint, TokenAccount, TokenInterface};
use crate::{state::*, errors::*, constants::*};

/// Close the pool (operator only, requires no outstanding transfers)
pub fn close_pool(ctx: Context<ClosePool>, withdrawal_amount: u64) -> Result<()> {
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

    // Validate withdrawal amount matches pool balance
    require!(
        withdrawal_amount <= ctx.accounts.pool_token_account.amount,
        HandshakeError::InsufficientFunds
    );

    // Transfer remaining tokens to operator
    let pool_seeds = &[POOL_SEED, pool.pool_id.as_ref(), &[pool.bump]];
    let pool_signer_seeds = &[&pool_seeds[..]];

    let transfer_accounts = TransferChecked {
        from: ctx.accounts.pool_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.operator_token_account.to_account_info(),
        authority: pool.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        transfer_accounts,
        pool_signer_seeds,
    );
    transfer_checked(cpi_ctx, withdrawal_amount, ctx.accounts.mint.decimals)?;

    emit!(PoolClosed {
        pool: pool.key(),
        operator: pool.operator,
        withdrawal_amount,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct ClosePool<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,

    /// The pool (will be closed)
    #[account(
        mut,
        seeds = [
            POOL_SEED,
            pool.pool_id.as_ref()
        ],
        bump = pool.bump,
        close = operator
    )]
    pub pool: Box<Account<'info, Pool>>,

    /// The mint for validation
    #[account(
        constraint = mint.key() == pool.mint
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    /// Pool's token account
    #[account(
        mut,
        associated_token::mint = pool.mint,
        associated_token::authority = pool,
        associated_token::token_program = token_program
    )]
    pub pool_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Operator's token account
    #[account(
        mut,
        associated_token::mint = pool.mint,
        associated_token::authority = operator,
        associated_token::token_program = token_program
    )]
    pub operator_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[event]
pub struct PoolClosed {
    pub pool: Pubkey,
    pub operator: Pubkey,
    pub withdrawal_amount: u64,
}
