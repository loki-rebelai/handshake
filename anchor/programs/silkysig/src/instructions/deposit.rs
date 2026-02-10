use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, TransferChecked, Mint, TokenAccount, TokenInterface,
};
use crate::{state::*, constants::*};

pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    let transfer_accounts = TransferChecked {
        from: ctx.accounts.depositor_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.account_token_account.to_account_info(),
        authority: ctx.accounts.depositor.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        transfer_accounts,
    );
    transfer_checked(cpi_ctx, amount, ctx.accounts.mint.decimals)?;

    emit!(Deposited {
        account: ctx.accounts.silk_account.key(),
        depositor: ctx.accounts.depositor.key(),
        mint: ctx.accounts.mint.key(),
        amount,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    /// The Silk account receiving the deposit
    #[account(
        seeds = [ACCOUNT_SEED, silk_account.owner.as_ref()],
        bump = silk_account.bump,
    )]
    pub silk_account: Box<Account<'info, SilkAccount>>,

    /// Mint must match the account's mint
    #[account(
        constraint = mint.key() == silk_account.mint
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    /// Account PDA's token account (destination)
    #[account(
        mut,
        associated_token::mint = silk_account.mint,
        associated_token::authority = silk_account,
        associated_token::token_program = token_program
    )]
    pub account_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Depositor's token account (source)
    #[account(
        mut,
        associated_token::mint = silk_account.mint,
        associated_token::authority = depositor,
        associated_token::token_program = token_program
    )]
    pub depositor_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[event]
pub struct Deposited {
    pub account: Pubkey,
    pub depositor: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
}
