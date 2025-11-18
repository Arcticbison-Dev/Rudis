#!/bin/bash

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║     XMR Rail Simulated Integration Test Suite            ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# Test configuration
export RAIL_AUTH_TOKEN="test-rail-token-simulated-12345"
export MOCK_RPC_PORT="18082"

# XMR Rail configuration (for simulated testing)
export PORT=5003
export PAYMENTS_SERVICE_URL="http://localhost:5000"
export XMR_RPC_HOST="127.0.0.1"
export XMR_RPC_PORT="18082"
export XMR_RPC_USERNAME="test-user"
export XMR_RPC_PASSWORD="test-password"
export XMR_ACCOUNT_INDEX="0"
export XMR_CONFIRMATIONS_REQUIRED="10"
export POLLING_INTERVAL_MS="30000"
export DATABASE_PATH="./xmr_rail_test.db"

echo "Step 1: Starting Mock Monero Wallet RPC..."
cd rail-xmr/test-utils
npm run mock-rpc &
MOCK_PID=$!
cd ../..

sleep 3

echo ""
echo "Step 2: Starting XMR Rail Service..."
cd rail-xmr
npm run dev &
RAIL_PID=$!
cd ..

sleep 5

echo ""
echo "Step 3: Waiting for services to be ready..."
sleep 5

echo ""
echo "Step 4: Running Integration Tests..."
cd rail-xmr/test-utils
npm run integration-test
TEST_RESULT=$?
cd ../..

echo ""
echo "Step 5: Cleaning up..."
kill $MOCK_PID 2>/dev/null
kill $RAIL_PID 2>/dev/null

echo ""
if [ $TEST_RESULT -eq 0 ]; then
  echo "✓ All tests passed!"
  exit 0
else
  echo "✗ Some tests failed!"
  exit 1
fi
