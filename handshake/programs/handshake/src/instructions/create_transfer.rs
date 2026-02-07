use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{transfer_checked, TransferChecked, Mint, TokenAccount, TokenInterface},
};
use crate::{state::*, errors::*, constants::*};

/// Create a new transfer (escrow)
pub fn create_transfer<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, CreateTransfer<'info>>,
    recipient: Pubkey,
    nonce: u64,
    amount: u64,
    memo: String,
    claimable_after: i64,
    claimable_until: i64,
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let transfer = &mut ctx.accounts.transfer;

    // Validate pool is not paused
    require!(!pool.is_paused, HandshakeError::PoolPaused);

    // Validate amount
    require!(amount > 0, HandshakeError::DepositTooSmall);

    // Transfer tokens from sender to pool
    let transfer_accounts = TransferChecked {
        from: ctx.accounts.sender_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.pool_token_account.to_account_info(),
        authority: ctx.accounts.sender.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        transfer_accounts,
    );
    transfer_checked(cpi_ctx, amount, ctx.accounts.mint.decimals)?;

    // Initialize transfer account
    transfer.initialize(
        ctx.bumps.transfer,
        nonce,
        ctx.accounts.sender.key(),
        recipient,
        pool.key(),
        amount,
        memo.clone(),
        claimable_after,
        claimable_until,
    )?;

    // Update pool accounting
    pool.add_deposit(amount)?;
    pool.increment_transfers_created()?;

    emit!(TransferCreated {
        transfer: transfer.key(),
        pool: pool.key(),
        sender: transfer.sender,
        recipient: transfer.recipient,
        amount,
        nonce,
        memo,
        claimable_after,
        claimable_until,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(recipient: Pubkey, nonce: u64)]
pub struct CreateTransfer<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

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

    /// Pool's token account where funds are stored
    #[account(
        mut,
        associated_token::mint = pool.mint,
        associated_token::authority = pool,
        associated_token::token_program = token_program
    )]
    pub pool_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Sender's token account
    #[account(
        mut,
        associated_token::mint = pool.mint,
        associated_token::authority = sender,
        associated_token::token_program = token_program
    )]
    pub sender_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Transfer account - PDA derived from sender, recipient, and nonce
    #[account(
        init,
        payer = sender,
        space = SecureTransfer::SPACE,
        seeds = [
            SENDER_SEED,
            sender.key().as_ref(),
            RECIPIENT_SEED,
            recipient.key().as_ref(),
            NONCE_SEED,
            nonce.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub transfer: Box<Account<'info, SecureTransfer>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[event]
pub struct TransferCreated {
    pub transfer: Pubkey,
    pub pool: Pubkey,
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub nonce: u64,
    pub memo: String,
    pub claimable_after: i64,
    pub claimable_until: i64,
}
