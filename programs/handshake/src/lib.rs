use anchor_lang::prelude::*;

mod constants;
mod errors;
mod instructions;
mod state;

use instructions::*;
use state::*;

declare_id!("HZ8paEkYZ2hKBwHoVk23doSLEad9K5duASRTGaYogmfg");

#[program]
pub mod handshake {
    use super::*;

    pub fn init_pool(
        ctx: Context<InitPool>,
        pool_id: Pubkey,
        transfer_fee_bps: u16,
    ) -> Result<()> {
        instructions::init_pool(ctx, pool_id, transfer_fee_bps)
    }

    pub fn create_transfer<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, CreateTransfer<'info>>,
        recipient: Pubkey,
        nonce: u64,
        amount: u64,
        memo: String,
        claimable_after: i64,
        claimable_until: i64,
    ) -> Result<()> {
        instructions::create_transfer(
            ctx,
            recipient,
            nonce,
            amount,
            memo,
            claimable_after,
            claimable_until,
        )
    }

    pub fn claim_transfer<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, ClaimTransfer<'info>>,
    ) -> Result<()> {
        instructions::claim_transfer(ctx)
    }

    pub fn cancel_transfer<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, CancelTransfer<'info>>,
    ) -> Result<()> {
        instructions::cancel_transfer(ctx)
    }

    pub fn reject_transfer<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, RejectTransfer<'info>>,
        reason_code: u8,
        reason_message: String,
    ) -> Result<()> {
        instructions::reject_transfer(ctx, reason_code, reason_message)
    }

    pub fn expire_transfer<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, ExpireTransfer<'info>>,
    ) -> Result<()> {
        instructions::expire_transfer(ctx)
    }

    pub fn withdraw_fees(ctx: Context<WithdrawFees>) -> Result<()> {
        instructions::withdraw_fees(ctx)
    }

    pub fn destroy_transfer(ctx: Context<DestroyTransfer>) -> Result<()> {
        instructions::destroy_transfer(ctx)
    }

    pub fn pause_pool(ctx: Context<PausePool>, is_paused: bool) -> Result<()> {
        instructions::pause_pool(ctx, is_paused)
    }

    pub fn reset_pool(ctx: Context<ResetPool>) -> Result<()> {
        instructions::reset_pool(ctx)
    }

    pub fn close_pool(ctx: Context<ClosePool>, withdrawal_amount: u64) -> Result<()> {
        instructions::close_pool(ctx, withdrawal_amount)
    }
}
