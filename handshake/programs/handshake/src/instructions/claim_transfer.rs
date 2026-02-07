use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, TransferChecked, Mint, TokenAccount, TokenInterface};
use crate::{state::*, errors::*, constants::*};

/// Claim an active transfer as the recipient
pub fn claim_transfer<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, ClaimTransfer<'info>>,
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let transfer = &mut ctx.accounts.transfer;

    // Validate recipient can claim
    transfer.validate_recipient_can_claim(ctx.accounts.recipient.key())?;

    // Calculate fee
    let fee = pool.calculate_transfer_fee(transfer.amount);
    let net_amount = transfer.amount.saturating_sub(fee);

    // Transfer net amount to recipient using pool authority
    let pool_seeds = &[POOL_SEED, pool.pool_id.as_ref(), &[pool.bump]];
    let pool_signer_seeds = &[&pool_seeds[..]];

    let transfer_accounts = TransferChecked {
        from: ctx.accounts.pool_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.recipient_token_account.to_account_info(),
        authority: pool.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        transfer_accounts,
        pool_signer_seeds,
    );
    transfer_checked(cpi_ctx, net_amount, ctx.accounts.mint.decimals)?;

    // Update pool accounting
    pool.add_withdrawal(transfer.amount)?;
    if fee > 0 {
        pool.add_collected_fees(fee)?;
    }
    pool.increment_transfers_resolved()?;

    // Mark transfer as claimed and close (rent to sender)
    transfer.mark_as_claimed()?;

    emit!(TransferClaimed {
        transfer: transfer.key(),
        pool: pool.key(),
        sender: transfer.sender,
        recipient: transfer.recipient,
        amount: transfer.amount,
        fee,
        net_amount,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct ClaimTransfer<'info> {
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

    /// Recipient's token account to receive funds
    #[account(
        mut,
        associated_token::mint = pool.mint,
        associated_token::authority = recipient,
        associated_token::token_program = token_program
    )]
    pub recipient_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Transfer account to claim (closed to sender on success)
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
pub struct TransferClaimed {
    pub transfer: Pubkey,
    pub pool: Pubkey,
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub fee: u64,
    pub net_amount: u64,
}
