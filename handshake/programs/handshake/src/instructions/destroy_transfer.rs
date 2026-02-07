use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, TransferChecked, Mint, TokenAccount, TokenInterface};
use crate::{state::*, errors::*, constants::*};

/// Emergency: destroy a transfer (operator only, pool must be paused)
pub fn destroy_transfer(ctx: Context<DestroyTransfer>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let transfer = &mut ctx.accounts.transfer;

    // Validate operator
    require!(
        ctx.accounts.operator.key() == pool.operator,
        HandshakeError::Unauthorized
    );

    // Validate pool is paused
    require!(pool.is_paused, HandshakeError::PoolPaused);

    // Validate transfer is active
    transfer.validate_active()?;

    // Transfer amount to operator (emergency withdrawal)
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
    transfer_checked(cpi_ctx, transfer.amount, ctx.accounts.mint.decimals)?;

    // Update pool accounting
    pool.add_withdrawal(transfer.amount)?;
    pool.increment_transfers_resolved()?;

    // Mark as rejected (closed to operator)
    transfer.mark_as_rejected()?;

    emit!(TransferDestroyed {
        transfer: transfer.key(),
        pool: pool.key(),
        sender: transfer.sender,
        recipient: transfer.recipient,
        amount: transfer.amount,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct DestroyTransfer<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,

    /// The pool (must be paused)
    #[account(
        mut,
        seeds = [
            POOL_SEED,
            pool.pool_id.as_ref()
        ],
        bump = pool.bump
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

    /// Operator's token account to receive funds
    #[account(
        mut,
        associated_token::mint = pool.mint,
        associated_token::authority = operator,
        associated_token::token_program = token_program
    )]
    pub operator_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Transfer to destroy (closed to operator)
    #[account(
        mut,
        close = operator,
        constraint = transfer.pool == pool.key()
    )]
    pub transfer: Box<Account<'info, SecureTransfer>>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[event]
pub struct TransferDestroyed {
    pub transfer: Pubkey,
    pub pool: Pubkey,
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
}
