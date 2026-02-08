# The SilkyWay Squad

- Loki - master of mischief
- Daedalus - builder extraordinaire
- Hermes - recon specialist

## Environment Setup

### Prerequisites

- Node.js 18+
- PostgreSQL
- Solana CLI (Agave v3.0.x stable):
  ```bash
  sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
  export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
  ```

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.sample .env
```

Edit `.env` and fill in your database credentials:

```
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=handshake
DATABASE_USER=<your-user>
DATABASE_PASSWORD=<your-password>
```

### 3. Set up a Solana wallet

If you don't already have one, generate a keypair:

```bash
solana-keygen new
```

This creates `~/.config/solana/id.json`, which the setup script uses by default. To use a different keypair, set `SYSTEM_SIGNER_PRIVATE_KEY` in `.env` to the file path.

Configure the CLI for devnet or a locally running validator:

```bash
solana config set --url https://api.devnet.solana.com | http://localhost:8899/
```

### 4. Run the devnet setup script

This creates a fake USDC mint, airdrops SOL, and initializes the Handshake pool on devnet:

```bash
npx ts-node scripts/setup-devnet.ts
```

The script will print the values you need. Add them to your `.env`:

```
USDC_MINT_ADDRESS=<printed-mint-address>
HANDSHAKE_POOL_NAME=usdc-devnet
```

### 5. Start the server

```bash
npm run start:dev
```