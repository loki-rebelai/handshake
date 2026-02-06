use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, TransferChecked, Mint, TokenAccount, TokenInterface};
use crate::{state::*, errors::*, constants::*};

/// Decline a transfer as the recipient (full refund to sender, no fee)
pub fn decline_transfer<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, DeclineTransfer<'info>>,
    reason: Option<u8>,
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let transfer = &mut ctx.accounts.transfer;

    // Validate recipient
    require!(
        ctx.accounts.recipient.key() == transfer.recipient,
        HandshakeError::Unauthorized
    );

    // Validate transfer is active
    transfer.validate_active()?;

    // Transfer full amount back to sender (no fee on decline)
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

    // Mark transfer as declined
    transfer.mark_as_declined()?;

    emit!(TransferDeclined {
        transfer: transfer.key(),
        pool: pool.key(),
        sender: transfer.sender,
        recipient: transfer.recipient,
        amount: transfer.amount,
        reason,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct DeclineTransfer<'info> {
    #[account(mut)]
    pub recipient: Signer<'info>,

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

    /// Transfer account to decline (closed to sender)
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
pub struct TransferDeclined {
    pub transfer: Pubkey,
    pub pool: Pubkey,
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub reason: Option<u8>,
}
