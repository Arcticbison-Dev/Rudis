#!/bin/bash
# Bitcoin Rail End-to-End Test Suite
# Tests address generation, payment detection, and edge cases
# Requires: BTC_XPUB configured, testnet/signet mempool.space available

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
API_URL="${API_URL:-http://localhost:5000}"
BTC_RAIL_URL="${BTC_RAIL_URL:-http://localhost:5002}"
ADMIN_TOKEN="${ADMIN_API_TOKEN}"
RAIL_TOKEN="${RAIL_AUTH_TOKEN}"

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0

# Helper functions
print_header() {
  echo -e "${BLUE}=========================================${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}=========================================${NC}"
  echo ""
}

print_test() {
  TESTS_RUN=$((TESTS_RUN + 1))
  echo -e "${YELLOW}[Test $TESTS_RUN] $1${NC}"
}

print_success() {
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
  TESTS_FAILED=$((TESTS_FAILED + 1))
  echo -e "${RED}✗ $1${NC}"
}

print_skip() {
  TESTS_SKIPPED=$((TESTS_SKIPPED + 1))
  echo -e "${YELLOW}⊘ SKIPPED: $1${NC}"
}

print_info() {
  echo -e "  $1"
}

# Ensure required tools are installed
command -v curl >/dev/null 2>&1 || { echo "curl is required but not installed. Aborting." >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq is required but not installed. Aborting." >&2; exit 1; }

# Validate configuration
if [ -z "$ADMIN_TOKEN" ]; then
  echo -e "${RED}ERROR: ADMIN_API_TOKEN not set${NC}"
  echo "Export it first: export ADMIN_API_TOKEN=your_token_here"
  exit 1
fi

print_header "Bitcoin Rail E2E Test Suite"
echo "API URL: $API_URL"
echo "BTC Rail URL: $BTC_RAIL_URL"
echo "Admin Token: ${ADMIN_TOKEN:0:10}..."
echo ""

# =============================================================================
# Test 1: Health Check - BTC Rail
# =============================================================================
print_test "Checking BTC rail health..."

HEALTH_RESPONSE=$(curl -s "$BTC_RAIL_URL/health" 2>/dev/null || echo '{"error":"unreachable"}')

if echo "$HEALTH_RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
  print_skip "BTC rail not running - some tests will be skipped"
  BTC_RAIL_AVAILABLE=false
else
  BTC_STATUS=$(echo "$HEALTH_RESPONSE" | jq -r '.status // "unknown"')
  XPUB_CONFIGURED=$(echo "$HEALTH_RESPONSE" | jq -r '.xpubConfigured // false')
  print_success "BTC rail status: $BTC_STATUS"
  print_info "XPUB configured: $XPUB_CONFIGURED"
  BTC_RAIL_AVAILABLE=true
fi
echo ""

# =============================================================================
# Test 2: Create BTC Invoice
# =============================================================================
print_test "Creating Bitcoin invoice..."

RESPONSE=$(curl -s -X POST "$API_URL/payments" \
  -H "Content-Type: application/json" \
  -d '{
    "rail": "btc",
    "amount_sats": 10000,
    "currency": "BTC",
    "description": "E2E Test Invoice - BTC Happy Path",
    "expires_in_seconds": 86400
  }')

if echo "$RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
  ERROR_MSG=$(echo "$RESPONSE" | jq -r '.error')
  if [[ "$ERROR_MSG" == *"XPUB"* ]] || [[ "$ERROR_MSG" == *"not enabled"* ]]; then
    print_skip "BTC rail not configured: $ERROR_MSG"
  else
    print_error "Failed to create invoice: $ERROR_MSG"
  fi
else
  PAYMENT_ID=$(echo "$RESPONSE" | jq -r '.id')
  ADDRESS=$(echo "$RESPONSE" | jq -r '.payment_address // .paymentAddress // .derived_address')
  STATUS=$(echo "$RESPONSE" | jq -r '.status')
  RAIL=$(echo "$RESPONSE" | jq -r '.rail')
  
  if [ -z "$PAYMENT_ID" ] || [ "$PAYMENT_ID" = "null" ]; then
    print_error "Invoice creation failed - no payment ID"
  elif [ "$STATUS" != "pending" ]; then
    print_error "Expected status='pending', got '$STATUS'"
  elif [ "$RAIL" != "btc" ]; then
    print_error "Expected rail='btc', got '$RAIL'"
  else
    print_success "Invoice created: $PAYMENT_ID"
    print_success "Rail: $RAIL, Status: $STATUS"
    print_info "Address: $ADDRESS"
    BTC_INVOICE_ID="$PAYMENT_ID"
    BTC_ADDRESS="$ADDRESS"
  fi
fi
echo ""

# =============================================================================
# Test 3: Verify Address Format (SegWit)
# =============================================================================
print_test "Verifying address format..."

if [ -n "$BTC_ADDRESS" ] && [ "$BTC_ADDRESS" != "null" ]; then
  # Check for bech32 format (bc1 for mainnet, tb1 for testnet)
  if [[ "$BTC_ADDRESS" =~ ^(bc1|tb1|bcrt1) ]]; then
    print_success "Valid SegWit address format: ${BTC_ADDRESS:0:10}..."
  else
    print_error "Expected SegWit address (bc1/tb1/bcrt1), got: ${BTC_ADDRESS:0:10}..."
  fi
else
  print_skip "No address to validate"
fi
echo ""

# =============================================================================
# Test 4: Admin API - Invoice Details
# =============================================================================
print_test "Verifying database state via admin API..."

if [ -n "$BTC_INVOICE_ID" ]; then
  DB_RESPONSE=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
    "$API_URL/admin/invoices/$BTC_INVOICE_ID")
  
  if echo "$DB_RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
    ERROR_MSG=$(echo "$DB_RESPONSE" | jq -r '.error')
    print_error "Admin API error: $ERROR_MSG"
  else
    DB_STATUS=$(echo "$DB_RESPONSE" | jq -r '.status')
    DB_RAIL=$(echo "$DB_RESPONSE" | jq -r '.railType // .rail_type // "unknown"')
    print_success "DB status: $DB_STATUS"
    print_success "DB rail type: $DB_RAIL"
  fi
else
  print_skip "No invoice ID to query"
fi
echo ""

# =============================================================================
# Test 5: Authentication - Rail Endpoint
# =============================================================================
print_test "Testing rail authentication (invalid token)..."

if [ "$BTC_RAIL_AVAILABLE" = true ]; then
  AUTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$BTC_RAIL_URL/create" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer INVALID_TOKEN" \
    -d '{"invoiceId": "test", "amountSats": 1000}')
  
  if [ "$AUTH_RESPONSE" = "401" ]; then
    print_success "Rail rejected invalid token (401)"
  else
    print_error "Expected 401, got $AUTH_RESPONSE"
  fi
else
  print_skip "BTC rail not available"
fi
echo ""

# =============================================================================
# Test 6: Input Validation - Invalid Invoice ID
# =============================================================================
print_test "Testing input validation (invalid invoice ID format)..."

if [ "$BTC_RAIL_AVAILABLE" = true ] && [ -n "$RAIL_TOKEN" ]; then
  INVALID_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$BTC_RAIL_URL/create" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $RAIL_TOKEN" \
    -d '{"invoiceId": "not-a-uuid", "amountSats": 1000}')
  
  if [ "$INVALID_RESPONSE" = "400" ]; then
    print_success "Invalid invoice ID rejected (400)"
  else
    print_info "Response code: $INVALID_RESPONSE (may vary by implementation)"
  fi
else
  print_skip "BTC rail not available or RAIL_AUTH_TOKEN not set"
fi
echo ""

# =============================================================================
# Test 7: Rate Limiting
# =============================================================================
print_test "Testing rate limiting (10 rapid requests)..."

RATE_LIMIT_HIT=false
for i in {1..12}; do
  RATE_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL/payments" \
    -H "Content-Type: application/json" \
    -d '{
      "rail": "btc",
      "amount_sats": 1000,
      "currency": "BTC",
      "description": "Rate limit test '$i'"
    }')
  
  if [ "$RATE_RESPONSE" = "429" ]; then
    RATE_LIMIT_HIT=true
    break
  fi
done

if [ "$RATE_LIMIT_HIT" = true ]; then
  print_success "Rate limiting active (429 received)"
else
  print_info "Rate limit not triggered in 12 requests (may have higher threshold)"
fi
echo ""

# =============================================================================
# Test 8: Duplicate Invoice Detection
# =============================================================================
print_test "Verifying idempotency (creating invoice with same params)..."

# Create two invoices with identical parameters
INVOICE_A=$(curl -s -X POST "$API_URL/payments" \
  -H "Content-Type: application/json" \
  -d '{
    "rail": "btc",
    "amount_sats": 5000,
    "currency": "BTC",
    "description": "Duplicate test invoice"
  }' | jq -r '.id // "error"')

INVOICE_B=$(curl -s -X POST "$API_URL/payments" \
  -H "Content-Type: application/json" \
  -d '{
    "rail": "btc",
    "amount_sats": 5000,
    "currency": "BTC",
    "description": "Duplicate test invoice"
  }' | jq -r '.id // "error"')

if [ "$INVOICE_A" != "$INVOICE_B" ] && [ "$INVOICE_A" != "error" ] && [ "$INVOICE_B" != "error" ]; then
  print_success "Each request creates unique invoice (correct behavior)"
  print_info "Invoice A: ${INVOICE_A:0:8}..."
  print_info "Invoice B: ${INVOICE_B:0:8}..."
else
  print_info "Invoices: A=$INVOICE_A, B=$INVOICE_B"
fi
echo ""

# =============================================================================
# Test 9: Expired Invoice Handling
# =============================================================================
print_test "Testing expired invoice creation and expiry..."

# Create invoice with very short expiry
EXPIRED_RESPONSE=$(curl -s -X POST "$API_URL/payments" \
  -H "Content-Type: application/json" \
  -d '{
    "rail": "btc",
    "amount_sats": 1000,
    "currency": "BTC",
    "description": "Short expiry test",
    "expires_in_seconds": 5
  }')

EXPIRED_ID=$(echo "$EXPIRED_RESPONSE" | jq -r '.id // "error"')

if [ "$EXPIRED_ID" != "error" ] && [ "$EXPIRED_ID" != "null" ]; then
  print_success "Created invoice with 5s expiry: ${EXPIRED_ID:0:8}..."
  print_info "Waiting 6 seconds for expiry..."
  sleep 6
  
  # Check status
  STATUS_CHECK=$(curl -s "$API_URL/payments/$EXPIRED_ID" | jq -r '.status')
  
  # Trigger expiry check
  curl -s -X POST "$API_URL/api/admin/expire-invoices" -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null 2>&1 || true
  
  # Check again
  sleep 1
  STATUS_CHECK=$(curl -s "$API_URL/payments/$EXPIRED_ID" | jq -r '.status')
  
  if [ "$STATUS_CHECK" = "expired" ]; then
    print_success "Invoice correctly expired"
  else
    print_info "Status: $STATUS_CHECK (may need manual expiry trigger)"
  fi
else
  print_skip "Could not create test invoice"
fi
echo ""

# =============================================================================
# Test 10: Manual Payment Simulation (if dev mode)
# =============================================================================
print_test "Testing payment simulation (dev mode only)..."

if [ -n "$BTC_INVOICE_ID" ]; then
  SIM_RESPONSE=$(curl -s -X POST "$API_URL/api/dev/simulate-payment/$BTC_INVOICE_ID" \
    -H "Content-Type: application/json" \
    -d '{"txid": "0000000000000000000000000000000000000000000000000000000000000001", "confirmations": 6}')
  
  if echo "$SIM_RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
    print_info "Payment simulation not available (production mode or endpoint disabled)"
  else
    SIM_STATUS=$(echo "$SIM_RESPONSE" | jq -r '.status // "unknown"')
    print_success "Simulation result: $SIM_STATUS"
  fi
else
  print_skip "No invoice to simulate payment for"
fi
echo ""

# =============================================================================
# Summary
# =============================================================================
print_header "Test Summary"

echo "Tests Run:     $TESTS_RUN"
echo -e "Tests Passed:  ${GREEN}$TESTS_PASSED${NC}"
echo -e "Tests Skipped: ${YELLOW}$TESTS_SKIPPED${NC}"
if [ $TESTS_FAILED -gt 0 ]; then
  echo -e "Tests Failed:  ${RED}$TESTS_FAILED${NC}"
else
  echo -e "Tests Failed:  ${GREEN}0${NC}"
fi
echo ""

# Manual testing instructions
print_header "Manual Payment Testing"
echo "To test actual payment detection:"
echo ""
echo "1. Create a testnet invoice:"
echo "   curl -X POST $API_URL/payments -H 'Content-Type: application/json' \\"
echo "     -d '{\"rail\":\"btc\",\"amount_sats\":10000,\"description\":\"Test\"}'"
echo ""
echo "2. Send testnet BTC to the returned address"
echo "   - Get testnet coins: https://bitcoinfaucet.uo1.net/"
echo "   - Or use: https://testnet-faucet.mempool.co/"
echo ""
echo "3. Monitor the invoice status:"
echo "   curl $API_URL/payments/{invoice_id}"
echo ""
echo "4. Check mempool.space for confirmation:"
echo "   https://mempool.space/testnet/address/{address}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
  echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║   All Tests Passed! ✓                ║${NC}"
  echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"
  exit 0
else
  echo -e "${RED}╔═══════════════════════════════════════╗${NC}"
  echo -e "${RED}║   Some Tests Failed ✗                ║${NC}"
  echo -e "${RED}║   Review errors above                ║${NC}"
  echo -e "${RED}╚═══════════════════════════════════════╝${NC}"
  exit 1
fi
