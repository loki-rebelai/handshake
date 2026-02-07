use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, TransferChecked, Mint, TokenAccount, TokenInterface};
use crate::{state::*, errors::*, constants::*};

/// Withdraw collected fees (operator only)
pub fn withdraw_fees(ctx: Context<WithdrawFees>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    // Validate operator
    require!(
        ctx.accounts.operator.key() == pool.operator,
        HandshakeError::Unauthorized
    );

    let fees = pool.collected_fees;
    require!(fees > 0, HandshakeError::CalculationError);

    // Transfer fees to operator
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
    transfer_checked(cpi_ctx, fees, ctx.accounts.mint.decimals)?;

    // Reset collected fees
    pool.reset_collected_fees();

    emit!(FeesWithdrawn {
        pool: pool.key(),
        operator: pool.operator,
        amount: fees,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,

    /// The pool
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

    /// Operator's token account to receive fees
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
pub struct FeesWithdrawn {
    pub pool: Pubkey,
    pub operator: Pubkey,
    pub amount: u64,
}
