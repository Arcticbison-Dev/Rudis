# Test Network Setup Guide

This document provides URLs and setup instructions for test accounts on all three payment rails.

---

## Quick Reference

| Rail | Network | Test Environment | Faucet |
|------|---------|------------------|--------|
| Lightning | Testnet/Signet | LNbits | legend.lnbits.com |
| Bitcoin | Testnet4/Signet | mempool.space | Multiple faucets |
| Monero | Stagenet | Monero CLI | community.rino.io |

---

## Lightning Network (LN)

### LNbits (Recommended)

LNbits provides a custodial Lightning wallet with full API access - perfect for testing.

> **WARNING**: Public LNbits instances (legend.lnbits.com, demo.lnbits.com) use **REAL MAINNET SATOSHIS**. For true test environments, use self-hosted LNbits on testnet or a testnet Lightning provider like Voltage.

#### Option 1: Self-Hosted LNbits on Testnet (RECOMMENDED for Testing)

For genuine test environments without real funds:

```bash
# Clone LNbits
git clone https://github.com/lnbits/lnbits.git
cd lnbits

# Configure for testnet (connect to testnet LND/CLN)
cp .env.example .env
# Edit .env to connect to your testnet Lightning node
# Or use FakeWallet for local testing without a node

docker compose up -d
```

**Configuration**:
```bash
ENABLE_LN=true
LNBITS_API_URL=http://localhost:5001  # Your local LNbits
LNBITS_WALLET_KEY=<from-local-lnbits>
LNBITS_WEBHOOK_SECRET=$(openssl rand -hex 32)
```

#### Option 2: Voltage.cloud Testnet (Hosted Testnet Node)

**URL**: https://voltage.cloud

Voltage provides hosted Lightning nodes with testnet support.

1. Create account at https://voltage.cloud
2. Spin up a **testnet** node
3. Enable REST API
4. Use LND REST API directly or connect LNbits

**Configuration**:
```bash
LNBITS_API_URL=https://your-voltage-node.voltageapp.io
```

#### Option 3: Legend LNbits (MAINNET - Use Small Amounts)

**URL**: https://legend.lnbits.com

> **CAUTION**: This uses REAL MAINNET SATOSHIS. Only use for small integration tests (100-1000 sats).

**Setup**:
1. Visit https://legend.lnbits.com
2. Click "Create Wallet" (no signup required)
3. Save your wallet URL (contains your access keys)
4. Go to "API Docs" in the menu
5. Copy the "Invoice/Read Key" (this is your `LNBITS_WALLET_KEY`)

**Configuration**:
```bash
ENABLE_LN=true
LNBITS_API_URL=https://legend.lnbits.com
LNBITS_WALLET_KEY=<your-invoice-read-key>
LNBITS_WEBHOOK_SECRET=$(openssl rand -hex 32)
LNBITS_WEBHOOK_URL=https://your-public-url/rails/ln/webhook/${LNBITS_WEBHOOK_SECRET}
```

**Note**: Start with tiny amounts (100-500 sats) for integration testing only.

#### Option 4: demo.lnbits.com (MAINNET)

**URL**: https://demo.lnbits.com

> **CAUTION**: Also uses REAL MAINNET SATOSHIS.

Same setup process as Legend LNbits. May have different rate limits.

#### Getting Testnet Lightning Satoshis

1. **LNURL Faucet**: https://htlc.me (paste invoice, receive sats)
2. **Stacker News**: https://stacker.news (earn sats for content)
3. **Ask in community**: Various Discord/Telegram groups distribute testnet sats

---

## Bitcoin On-Chain (BTC)

### Testnet vs Signet

| Network | Reliability | Coins | Recommendation |
|---------|-------------|-------|----------------|
| Testnet3 | Variable (spam issues) | Easy to get | Basic testing |
| Testnet4 | More stable | Limited faucets | Better testing |
| Signet | Very stable | Controlled faucets | Best for CI/CD |

### Testnet4 (Recommended)

**Block Explorer**: https://mempool.space/testnet4

**Faucets**:
- https://testnet4.anyone.eu.org/ (recommended)
- Bitcoin Core built-in (if running node)

**Configuration**:
```bash
ENABLE_BTC=true
BTC_NETWORK=testnet
MEMPOOL_API_BASE=https://mempool.space/testnet4/api
BTC_CONFIRMATIONS_REQUIRED=2
BTC_XPUB=<your-testnet-xpub>
```

**Getting a Testnet XPUB**:

Option A: Electrum Wallet
1. Download Electrum: https://electrum.org
2. Create new wallet (File > New/Restore)
3. Select "Standard wallet" > "Create new seed"
4. Choose "Segwit (bech32)"
5. Go to Wallet > Information
6. Copy the "Master public key" (xpub/zpub)

Option B: Sparrow Wallet
1. Download Sparrow: https://sparrowwallet.com
2. Create new wallet
3. Go to Settings > Export > Show descriptor
4. Extract the xpub from the descriptor

### Signet

**Block Explorer**: https://mempool.space/signet

**Faucet**: https://signetfaucet.com

**Configuration**:
```bash
BTC_NETWORK=signet
MEMPOOL_API_BASE=https://mempool.space/signet/api
```

### Regtest (Local Development)

For local testing without external dependencies:

```bash
# Start Bitcoin Core
bitcoind -regtest -daemon -rpcuser=test -rpcpassword=test

# Mine blocks
bitcoin-cli -regtest generatetoaddress 101 $(bitcoin-cli -regtest getnewaddress)

# Configuration
BTC_NETWORK=regtest
# Use local mempool or direct RPC
```

---

## Monero (XMR)

### Stagenet (Recommended for Testing)

Stagenet is Monero's permanent test network with no real value.

**Block Explorer**: https://stagenet.xmrchain.net

**Faucet**: https://community.rino.io/faucet/stagenet/

**Configuration**:
```bash
ENABLE_XMR=true
XMR_RPC_HOST=127.0.0.1
XMR_RPC_PORT=38082
XMR_RPC_USERNAME=<your-rpc-user>
XMR_RPC_PASSWORD=<your-rpc-pass>
XMR_CONFIRMATIONS_REQUIRED=2  # Lower for testing
```

### Setting Up Stagenet Wallet RPC

#### Step 1: Download Monero CLI

**URL**: https://www.getmonero.org/downloads/#cli

Download the CLI tools for your platform.

#### Step 2: Sync Stagenet Node (Optional)

For full validation, run your own stagenet node:

```bash
./monerod --stagenet --detach
```

Or connect to a public stagenet node:
- `stagenet.xmr.ditatompel.com:38081`
- `stagenet.community.rino.io:38081`

#### Step 3: Create Stagenet Wallet

```bash
./monero-wallet-cli --stagenet --generate-new-wallet stagenet_wallet
```

Save the seed phrase securely.

#### Step 4: Start Wallet RPC

```bash
./monero-wallet-rpc --stagenet \
  --wallet-file stagenet_wallet \
  --password your_wallet_password \
  --rpc-bind-port 38082 \
  --rpc-login user:pass \
  --confirm-external-bind
```

#### Step 5: Get Stagenet XMR

1. Visit https://community.rino.io/faucet/stagenet/
2. Enter your stagenet address (starts with `5` or `7`)
3. Wait for confirmation (~2 minutes on stagenet)

### Testnet (Alternative)

Testnet is less stable than stagenet but available.

**Faucet**: https://community.rino.io/faucet/testnet/

```bash
XMR_RPC_HOST=127.0.0.1
XMR_RPC_PORT=28082  # Testnet port
```

---

## Complete Test Environment Setup

### Prerequisites

1. Clone and install the payments service
2. Generate required secrets (see OPERATIONS_GUIDE.md)
3. Start the database

### Minimal LN-Only Setup

```bash
# .env file
NODE_ENV=development
DATABASE_URL=postgresql://...
SESSION_SECRET=$(openssl rand -hex 32)
RAIL_AUTH_TOKEN=$(openssl rand -hex 32)
ADMIN_API_TOKEN=$(openssl rand -hex 32)

# Lightning only
ENABLE_LN=true
LNBITS_API_URL=https://legend.lnbits.com
LNBITS_WALLET_KEY=<your-key>
LNBITS_WEBHOOK_SECRET=$(openssl rand -hex 32)
```

### Full Three-Rail Setup

```bash
# Core
NODE_ENV=development
DATABASE_URL=postgresql://...
SESSION_SECRET=$(openssl rand -hex 32)
RAIL_AUTH_TOKEN=$(openssl rand -hex 32)
ADMIN_API_TOKEN=$(openssl rand -hex 32)

# Lightning
ENABLE_LN=true
LNBITS_API_URL=https://legend.lnbits.com
LNBITS_WALLET_KEY=<your-key>
LNBITS_WEBHOOK_SECRET=$(openssl rand -hex 32)

# Bitcoin
ENABLE_BTC=true
BTC_NETWORK=testnet
BTC_XPUB=<your-testnet-xpub>
BTC_CONFIRMATIONS_REQUIRED=2
MEMPOOL_API_BASE=https://mempool.space/testnet4/api

# Monero
ENABLE_XMR=true
XMR_RPC_HOST=127.0.0.1
XMR_RPC_PORT=38082
XMR_RPC_USERNAME=user
XMR_RPC_PASSWORD=pass
XMR_CONFIRMATIONS_REQUIRED=2
```

---

## Test Accounts Summary

### Lightning (LNbits)
- **Create wallet**: https://legend.lnbits.com
- **Alternative**: https://demo.lnbits.com
- **Self-hosted**: Docker via github.com/lnbits/lnbits
- **Get sats**: htlc.me or any LN wallet

### Bitcoin
- **Explorer**: https://mempool.space/testnet4
- **Faucet**: https://testnet4.anyone.eu.org/
- **Wallet for xpub**: Electrum or Sparrow (testnet mode)

### Monero
- **Explorer**: https://stagenet.xmrchain.net
- **Faucet**: https://community.rino.io/faucet/stagenet/
- **Wallet RPC**: Monero CLI tools from getmonero.org

---

## Troubleshooting

### LNbits "502 Bad Gateway"

Legend LNbits occasionally has maintenance. Try:
1. Wait 10-15 minutes and retry
2. Use demo.lnbits.com instead
3. Self-host LNbits for reliability

### Bitcoin "XPUB not configured"

1. Ensure `BTC_XPUB` is set in environment
2. Verify it's a valid testnet xpub (starts with `tpub` or `vpub`)
3. Check network matches (`BTC_NETWORK=testnet`)

### Monero "RPC connection refused"

1. Verify wallet RPC is running: `curl http://127.0.0.1:38082/json_rpc`
2. Check credentials match `XMR_RPC_USERNAME` and `XMR_RPC_PASSWORD`
3. Ensure wallet file exists and password is correct

### Invoice Created But Payment Not Detected

1. Confirm transaction is confirmed on blockchain
2. Check rail health: `curl http://localhost:5002/health` (BTC) or `5003` (XMR)
3. Verify polling interval isn't too long for testing

---

## Running Test Suites

### Quick Start: Environment to Test Suite Mapping

Before running tests, set these environment variables:

```bash
# Required for ALL test suites
export ADMIN_API_TOKEN="your-admin-token"
export API_URL="http://localhost:5000"

# For simulation tests (requires SIMULATION_ENABLED=true on server)
export ADMIN_SIM_TOKEN="your-simulation-token"

# Test mode: "strict" fails on missing simulation, "lenient" skips
export TEST_MODE="lenient"

# For BTC tests
export BTC_RAIL_URL="http://localhost:5002"
export RAIL_AUTH_TOKEN="your-rail-token"

# For XMR tests
export XMR_RAIL_URL="http://localhost:5003"

# For LN tests
export LNBITS_WEBHOOK_SECRET="your-webhook-secret"
```

**Important**: To enable payment simulation for testing, the server must have:
- `SIMULATION_ENABLED=true`
- `ADMIN_SIM_TOKEN` matching your test environment

### Running Each Suite

```bash
# Lightning Network
./test-ln-e2e.sh

# Bitcoin
./test-btc-e2e.sh

# Monero
./test-xmr-e2e.sh
```

### CI/CD Integration

```yaml
# Example GitHub Actions
- name: Run E2E Tests
  env:
    ADMIN_API_TOKEN: ${{ secrets.ADMIN_API_TOKEN }}
    RAIL_AUTH_TOKEN: ${{ secrets.RAIL_AUTH_TOKEN }}
    API_URL: http://localhost:5000
  run: |
    ./test-ln-e2e.sh
    ./test-btc-e2e.sh
    ./test-xmr-e2e.sh
```

### Test Coverage per Suite

| Test Suite | Scenarios | Requires Live Network |
|------------|-----------|----------------------|
| test-ln-e2e.sh | 9 (of 10) | Yes (LNbits) |
| test-btc-e2e.sh | 10 | Partial (testnet for full) |
| test-xmr-e2e.sh | 10 | Partial (stagenet for full) |

---

## Related Documentation

- [OPERATIONS_GUIDE.md](./OPERATIONS_GUIDE.md) - Secrets and deployment
- [REORG_TESTING_GUIDE.md](./REORG_TESTING_GUIDE.md) - Blockchain reorg testing
- [test-ln-e2e.sh](../test-ln-e2e.sh) - Lightning E2E tests
- [test-btc-e2e.sh](../test-btc-e2e.sh) - Bitcoin E2E tests
- [test-xmr-e2e.sh](../test-xmr-e2e.sh) - Monero E2E tests
