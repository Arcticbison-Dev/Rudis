#!/bin/bash

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║     XMR Rail Standalone Test (Mock RPC)                  ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# Configuration
export RAIL_AUTH_TOKEN="test-rail-token-12345"
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
export MOCK_RPC_PORT="18082"

# Start mock Wallet RPC
echo "Starting Mock Monero Wallet RPC on port 18082..."
cd test-utils
npx tsx mock-wallet-rpc.ts &
MOCK_PID=$!
cd ..

sleep 3

# Start XMR rail service
echo ""
echo "Starting XMR Rail Service on port 5003..."
npx tsx src/index.ts &
RAIL_PID=$!

sleep 5

# Run tests
echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║                   Running Tests                           ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

PASSED=0
FAILED=0

# Test 1: Health check
echo "Test 1: Health Check"
echo "─────────────────────────────────────────────────────────"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5003/health)
if [ "$HTTP_CODE" == "200" ]; then
  echo "✓ Health check passed (HTTP 200)"
  PASSED=$((PASSED + 1))
else
  echo "✗ Health check failed (HTTP $HTTP_CODE)"
  FAILED=$((FAILED + 1))
fi
echo ""

# Test 2: Create subaddress (with auth)
echo "Test 2: Create Subaddress (Authenticated)"
echo "─────────────────────────────────────────────────────────"
RESPONSE=$(curl -s -X POST http://localhost:5003/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-rail-token-12345" \
  -d '{"invoiceId":"550e8400-e29b-41d4-a716-446655440000","amountAtomic":"500000000000"}')

if echo "$RESPONSE" | grep -q "subaddress"; then
  SUBADDRESS=$(echo "$RESPONSE" | grep -o '"subaddress":"[^"]*"' | cut -d'"' -f4)
  echo "✓ Subaddress created: ${SUBADDRESS:0:12}..."
  PASSED=$((PASSED + 1))
else
  echo "✗ Subaddress creation failed"
  echo "  Response: $RESPONSE"
  FAILED=$((FAILED + 1))
fi
echo ""

# Test 3: Authentication check (no token)
echo "Test 3: Authentication Security"
echo "─────────────────────────────────────────────────────────"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:5003/create \
  -H "Content-Type: application/json" \
  -d '{"invoiceId":"test-no-auth","amountAtomic":"1000000000000"}')

if [ "$HTTP_CODE" == "401" ]; then
  echo "✓ Unauthorized request correctly rejected (HTTP 401)"
  PASSED=$((PASSED + 1))
else
  echo "✗ Authentication test failed (HTTP $HTTP_CODE)"
  FAILED=$((FAILED + 1))
fi
echo ""

# Test 4: Idempotency (same invoice ID)
echo "Test 4: Idempotency Check"
echo "─────────────────────────────────────────────────────────"
RESPONSE2=$(curl -s -X POST http://localhost:5003/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-rail-token-12345" \
  -d '{"invoiceId":"550e8400-e29b-41d4-a716-446655440000","amountAtomic":"500000000000"}')

SUBADDRESS2=$(echo "$RESPONSE2" | grep -o '"subaddress":"[^"]*"' | cut -d'"' -f4)

if [ "$SUBADDRESS" == "$SUBADDRESS2" ]; then
  echo "✓ Same invoice ID returns same subaddress (idempotent)"
  PASSED=$((PASSED + 1))
else
  echo "✗ Idempotency failed: Different subaddresses returned"
  FAILED=$((FAILED + 1))
fi
echo ""

# Cleanup
echo "Cleaning up..."
kill $MOCK_PID 2>/dev/null
kill $RAIL_PID 2>/dev/null
rm -f xmr_rail_test.db 2>/dev/null

# Summary
echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║                    Test Summary                           ║"
echo "╠═══════════════════════════════════════════════════════════╣"
echo "║ Passed:       $PASSED                                               ║"
echo "║ Failed:       $FAILED                                               ║"
if [ $FAILED -eq 0 ]; then
  echo "║ Status:       ✓ ALL TESTS PASSED                          ║"
else
  echo "║ Status:       ✗ SOME TESTS FAILED                         ║"
fi
echo "╚═══════════════════════════════════════════════════════════╝"

if [ $FAILED -eq 0 ]; then
  exit 0
else
  exit 1
fi
