use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{
        transfer_checked, TransferChecked, Mint, TokenAccount, TokenInterface,
    },
};
use crate::{state::*, errors::*, constants::*};

pub fn transfer_from_account<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, TransferFromAccount<'info>>,
    amount: u64,
) -> Result<()> {
    let account = &ctx.accounts.silk_account;
    let signer_key = ctx.accounts.signer.key();

    if signer_key == account.owner {
        // Owner: no policy checks
    } else if let Some(idx) = account.find_operator(&signer_key) {
        // Operator: enforce policies
        require!(!account.is_paused, SilkysigError::AccountPaused);

        let operator = &account.operators[idx];
        if operator.per_tx_limit > 0 {
            require!(amount <= operator.per_tx_limit, SilkysigError::ExceedsPerTxLimit);
        }
    } else {
        return Err(SilkysigError::Unauthorized.into());
    }

    // Transfer tokens from account PDA's ATA to recipient's ATA
    let owner_key = account.owner;
    let account_seeds = &[
        ACCOUNT_SEED,
        owner_key.as_ref(),
        &[account.bump],
    ];
    let signer_seeds = &[&account_seeds[..]];

    let transfer_accounts = TransferChecked {
        from: ctx.accounts.account_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.recipient_token_account.to_account_info(),
        authority: ctx.accounts.silk_account.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        transfer_accounts,
        signer_seeds,
    );
    transfer_checked(cpi_ctx, amount, ctx.accounts.mint.decimals)?;

    emit!(TransferExecuted {
        account: ctx.accounts.silk_account.key(),
        signer: signer_key,
        recipient: ctx.accounts.recipient.key(),
        mint: ctx.accounts.mint.key(),
        amount,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct TransferFromAccount<'info> {
    /// Owner or operator — pays for recipient ATA init if needed
    #[account(mut)]
    pub signer: Signer<'info>,

    /// The Silk account to transfer from
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

    /// Account PDA's token account (source)
    #[account(
        mut,
        associated_token::mint = silk_account.mint,
        associated_token::authority = silk_account,
        associated_token::token_program = token_program
    )]
    pub account_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: Recipient address — only used as ATA derivation authority
    pub recipient: AccountInfo<'info>,

    /// Recipient's token account — initialized if needed, signer pays rent
    #[account(
        init_if_needed,
        payer = signer,
        associated_token::mint = mint,
        associated_token::authority = recipient,
        associated_token::token_program = token_program
    )]
    pub recipient_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct TransferExecuted {
    pub account: Pubkey,
    pub signer: Pubkey,
    pub recipient: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
}
