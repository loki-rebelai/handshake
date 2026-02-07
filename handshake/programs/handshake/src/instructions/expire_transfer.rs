use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, TransferChecked, Mint, TokenAccount, TokenInterface};
use crate::{state::*, errors::*, constants::*};

/// Expire a transfer past its claimable_until deadline (permissionless)
pub fn expire_transfer<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, ExpireTransfer<'info>>,
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let transfer = &mut ctx.accounts.transfer;

    // Validate transfer is expired
    require!(
        transfer.claimable_until > 0,
        HandshakeError::InvalidTimeWindow
    );
    
    let is_expired = transfer.is_expired()?;
    require!(is_expired, HandshakeError::CannotClaim);

    // Transfer full amount back to sender (NO fee on expiry)
    let pool_seeds = &[POOL_SEED, pool.pool_id.as_ref(), &[pool.bump]];
    let pool_signer_seeds = &[&pool_seeds[..]];

    let transfer_accounts = TransferChecked {
        from: ctx.accounts.pool_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.sender_token_account.to_account_info(),
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

    // Mark transfer as expired
    transfer.mark_as_expired()?;

    emit!(TransferExpired {
        transfer: transfer.key(),
        pool: pool.key(),
        sender: transfer.sender,
        recipient: transfer.recipient,
        amount: transfer.amount,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct ExpireTransfer<'info> {
    /// Anyone can call this (permissionless)
    pub caller: Signer<'info>,

    /// The pool this transfer belongs to
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

    /// Sender's token account to receive refund
    #[account(
        mut,
        associated_token::mint = pool.mint,
        associated_token::authority = transfer.sender,
        associated_token::token_program = token_program
    )]
    pub sender_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Transfer account to expire (closed to sender)
    #[account(
        mut,
        close = sender,
        constraint = transfer.pool == pool.key()
    )]
    pub transfer: Box<Account<'info, SecureTransfer>>,

    /// CHECK: Sender receives rent refund on close. Validated via transfer.sender constraint.
    #[account(mut)]
    pub sender: AccountInfo<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[event]
pub struct TransferExpired {
    pub transfer: Pubkey,
    pub pool: Pubkey,
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
}
