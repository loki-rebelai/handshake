# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a monorepo containing:
1. **Handshake** — A Solana program built with Anchor (v0.32.1), located in `/handshake`
2. **Site** — A NestJS agent-native website (root directory) for agents to interact with the Silkyway protocol
3. **SDK** — `@silkyway/sdk` — TypeScript SDK + CLI for agent payments on Solana, located in `/packages/sdk`

## Solana Program (`/handshake`)

**Program ID:** `HZ8paEkYZ2hKBwHoVk23doSLEad9K5duASRTGaYogmfg`

### Commands (run from `/handshake`)

```bash
cd handshake
anchor build          # Build the Solana program
anchor test           # Run all tests (requires local validator)
yarn run ts-mocha -p ./tsconfig.json -t 1000000 "tests/handshake.ts"  # Single test file
```

### Architecture

- **`handshake/programs/handshake/src/lib.rs`** — On-chain program. All instruction handlers and account structs.
- **`handshake/tests/`** — TypeScript integration tests (ts-mocha + chai).
- **`handshake/Anchor.toml`** — Anchor workspace config. Cluster is `localnet`; package manager is `yarn`.

### Toolchain

- Rust `1.89.0` (pinned in `handshake/rust-toolchain.toml`)
- Anchor CLI `0.32.1`
- **Agave (Solana) CLI v3.0.x stable** — Install with:
  ```
  sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
  ```
  Then: `export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"`

### Build Notes

- If `Cargo.lock` has `version = 4` and fails with "lock file version 4 requires `-Znext-lockfile-bump`", delete it and let `anchor build` regenerate.
- If crate version errors mention rustc mismatch, upgrade Agave CLI to stable.

## Silkyway SDK (`/packages/sdk`)

**Package:** `@silkyway/sdk` v0.1.0 — Agent payments on Solana via the Silkyway protocol.

Provides both a **TypeScript client library** and a **CLI** (`silk`).

### Commands (run from `/packages/sdk`)

```bash
cd packages/sdk
npm run build         # Compile TypeScript
npm run dev           # Watch mode
npm run clean         # Remove dist/
```

### Architecture

- **`packages/sdk/src/client.ts`** — HTTP client that talks to the Silkyway backend API.
- **`packages/sdk/src/cli.ts`** — CLI entry point (Commander-based, exposed as `silk` bin).
- **`packages/sdk/src/commands/`** — CLI subcommands: `wallet`, `balance`, `pay`, `claim`, `cancel`, `payments`.
- **`packages/sdk/src/config.ts`** — Wallet/config management (`~/.config/silk/config.json`).
- **`packages/sdk/SKILL.md`** — Agent-facing skill file shipped with the package (included in `files`).

### Toolchain

- Node.js 18+
- TypeScript 5.7, targeting ES2022 with `NodeNext` module resolution
- Dependencies: `@solana/web3.js`, `axios`, `bs58`, `commander`

## Silkyway Site (root)

NestJS agent-native website. Details TBD as the project is scaffolded.
