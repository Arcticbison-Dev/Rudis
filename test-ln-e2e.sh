#!/bin/bash
# Lightning Network End-to-End Test Suite
# Tests invoice creation, payment detection, and failure scenarios

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
API_URL="${API_URL:-http://localhost:5000}"
ADMIN_TOKEN="${ADMIN_API_TOKEN}"
RAIL_TOKEN="${RAIL_AUTH_TOKEN}"
SIM_TOKEN="${ADMIN_SIM_TOKEN}"

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

# Validate configuration - RAIL_AUTH_TOKEN is required for payment operations
if [ -z "$RAIL_TOKEN" ]; then
  echo -e "${RED}ERROR: RAIL_AUTH_TOKEN not set${NC}"
  echo "Export: export RAIL_AUTH_TOKEN=your_token_here"
  exit 1
fi

# ADMIN_API_TOKEN is optional (used for admin endpoints only)
if [ -z "$ADMIN_TOKEN" ]; then
  echo -e "${YELLOW}WARNING: ADMIN_API_TOKEN not set - admin endpoint tests will skip${NC}"
fi

print_header "Lightning Network E2E Test Suite"
echo "API URL: $API_URL"
echo "Admin Token: ${ADMIN_TOKEN:0:10}..."
echo ""

# =============================================================================
# Test 1: Create LN Invoice
# =============================================================================
print_test "Creating Lightning invoice..."

RESPONSE=$(curl -s -X POST "$API_URL/payments" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $RAIL_TOKEN" \
  -d '{
    "rail": "LN",
    "amount_atomic": "100",
    "description": "E2E Test Invoice - Happy Path"
  }')

# Check for errors
LN_CONFIGURED=true
if echo "$RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
  ERROR_MSG=$(echo "$RESPONSE" | jq -r '.error')
  if [[ "$ERROR_MSG" == *"config"* ]] || [[ "$ERROR_MSG" == *"disabled"* ]] || [[ "$ERROR_MSG" == *"unavailable"* ]]; then
    print_skip "LN not configured: $ERROR_MSG"
    LN_CONFIGURED=false
  else
    print_error "Failed to create invoice: $ERROR_MSG"
    echo "$RESPONSE" | jq .
    exit 1
  fi
fi

# If LN not configured, skip remaining tests and show summary
if [ "$LN_CONFIGURED" = "false" ]; then
  echo ""
  print_header "Test Summary"
  echo "Tests Run:     $TESTS_RUN"
  echo "Tests Passed:  $TESTS_PASSED"
  echo "Tests Failed:  $TESTS_FAILED"
  echo "Tests Skipped: $TESTS_SKIPPED"
  echo ""
  echo "LN not configured - remaining tests require ENABLE_LN=true and LNbits setup"
  echo "See: docs/LN_TESTING_QUICKSTART.md"
  if [ "$TESTS_FAILED" -eq 0 ]; then
    exit 0
  else
    exit 1
  fi
fi

PAYMENT_ID=$(echo "$RESPONSE" | jq -r '.id')
BOLT11=$(echo "$RESPONSE" | jq -r '.invoice_bolt11')
STATUS=$(echo "$RESPONSE" | jq -r '.status')
RAIL=$(echo "$RESPONSE" | jq -r '.rail')

if [ -z "$PAYMENT_ID" ] || [ "$PAYMENT_ID" = "null" ]; then
  print_error "Invoice creation failed - no payment ID"
  echo "$RESPONSE" | jq .
  exit 1
fi

if [ "$STATUS" != "pending" ]; then
  print_error "Expected status='pending', got '$STATUS'"
  exit 1
fi

if [ "$RAIL" != "LN" ]; then
  print_error "Expected rail='LN', got '$RAIL'"
  exit 1
fi

if [ -z "$BOLT11" ] || [ "$BOLT11" = "null" ]; then
  print_error "No BOLT11 invoice in response"
  exit 1
fi

print_success "Invoice created: $PAYMENT_ID"
print_success "Rail: $RAIL, Status: $STATUS"
print_info "BOLT11: ${BOLT11:0:50}..."
echo ""

# =============================================================================
# Test 2: Verify Database State (Admin API)
# =============================================================================
print_test "Verifying database state via admin API..."

DB_RESPONSE=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$API_URL/admin/invoices/$PAYMENT_ID")

# Check for auth errors
if echo "$DB_RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
  ERROR_MSG=$(echo "$DB_RESPONSE" | jq -r '.error')
  print_error "Admin API error: $ERROR_MSG"
  echo "$DB_RESPONSE" | jq .
  exit 1
fi

DB_STATUS=$(echo "$DB_RESPONSE" | jq -r '.status')
CHECKING_ID=$(echo "$DB_RESPONSE" | jq -r '.ln_checking_id')
PAYMENT_HASH=$(echo "$DB_RESPONSE" | jq -r '.ln_payment_hash')

if [ "$DB_STATUS" != "pending" ]; then
  print_error "DB status should be 'pending', got '$DB_STATUS'"
  exit 1
fi

if [ -z "$CHECKING_ID" ] || [ "$CHECKING_ID" = "null" ]; then
  print_error "ln_checking_id not set in DB"
  exit 1
fi

if [ -z "$PAYMENT_HASH" ] || [ "$PAYMENT_HASH" = "null" ]; then
  print_error "ln_payment_hash not set in DB"
  exit 1
fi

# Verify payment_hash is 64 hex characters
if ! echo "$PAYMENT_HASH" | grep -qE '^[a-f0-9]{64}$'; then
  print_error "Invalid payment_hash format: $PAYMENT_HASH"
  exit 1
fi

print_success "DB status: $DB_STATUS"
print_success "Checking ID: $CHECKING_ID"
print_success "Payment hash: ${PAYMENT_HASH:0:16}..."
echo ""

# =============================================================================
# Test 3: Verify Public API Filtering (Security)
# =============================================================================
print_test "Verifying public API response filtering..."

PUBLIC_RESPONSE=$(curl -s "$API_URL/api/invoices/$PAYMENT_ID")

if echo "$PUBLIC_RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
  ERROR_MSG=$(echo "$PUBLIC_RESPONSE" | jq -r '.error')
  print_error "Public API error: $ERROR_MSG"
  exit 1
fi

HAS_BOLT11=$(echo "$PUBLIC_RESPONSE" | jq -r '.bolt11Invoice')
HAS_CHECKING_ID=$(echo "$PUBLIC_RESPONSE" | jq -r '.lnCheckingId')
HAS_PAYMENT_HASH=$(echo "$PUBLIC_RESPONSE" | jq -r '.lnPaymentHash')

# BOLT11 should be present (users need this)
if [ -z "$HAS_BOLT11" ] || [ "$HAS_BOLT11" = "null" ]; then
  print_error "Public API should expose bolt11Invoice"
  exit 1
fi

# Internal fields should NOT be present
if [ "$HAS_CHECKING_ID" != "null" ]; then
  print_error "Public API leaking lnCheckingId (should be hidden)"
  exit 1
fi

if [ "$HAS_PAYMENT_HASH" != "null" ]; then
  print_error "Public API leaking lnPaymentHash (should be hidden)"
  exit 1
fi

print_success "BOLT11 exposed (correct - users need it)"
print_success "Checking ID hidden (correct - internal field)"
print_success "Payment hash hidden (correct - internal field)"
echo ""

# =============================================================================
# Test 4: Pay Invoice (Manual Step)
# =============================================================================
print_header "Manual Payment Step"
echo -e "${YELLOW}PAY THIS LIGHTNING INVOICE:${NC}"
echo ""
echo -e "${GREEN}$BOLT11${NC}"
echo ""
echo "1. Copy the BOLT11 invoice above"
echo "2. Open your Lightning wallet (Phoenix, Wallet of Satoshi, etc.)"
echo "3. Paste and pay the invoice"
echo "4. Wait for confirmation"
echo ""
echo -e "${BLUE}Press ENTER after payment completes...${NC}"
read

# =============================================================================
# Test 5: Verify Payment Detected
# =============================================================================
print_test "Verifying payment confirmation..."

# Wait a bit for webhook/polling to process
sleep 3

CONFIRM_RESPONSE=$(curl -s "$API_URL/payments/$PAYMENT_ID")

if echo "$CONFIRM_RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
  ERROR_MSG=$(echo "$CONFIRM_RESPONSE" | jq -r '.error')
  print_error "Payment status check failed: $ERROR_MSG"
  exit 1
fi

CONFIRM_STATUS=$(echo "$CONFIRM_RESPONSE" | jq -r '.status')
PAID_AT=$(echo "$CONFIRM_RESPONSE" | jq -r '.paid_at')
AMOUNT_PAID=$(echo "$CONFIRM_RESPONSE" | jq -r '.amount_paid_atomic')

if [ "$CONFIRM_STATUS" != "confirmed" ]; then
  print_error "Payment not confirmed! Status: $CONFIRM_STATUS"
  echo "Response:"
  echo "$CONFIRM_RESPONSE" | jq .
  exit 1
fi

if [ "$PAID_AT" = "null" ]; then
  print_error "paid_at timestamp not set"
  exit 1
fi

if [ "$AMOUNT_PAID" != "100" ]; then
  print_error "Incorrect amount_paid_atomic: $AMOUNT_PAID (expected 100)"
  exit 1
fi

print_success "Status: confirmed"
print_success "Paid at: $PAID_AT"
print_success "Amount paid: $AMOUNT_PAID sats"
echo ""

# =============================================================================
# Test 6: Verify Payment Transaction Row
# =============================================================================
print_test "Verifying payment transaction record..."

TX_RESPONSE=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$API_URL/admin/invoices/$PAYMENT_ID")

TX_COUNT=$(echo "$TX_RESPONSE" | jq -r '.transactions | length')

if [ "$TX_COUNT" -eq 0 ]; then
  print_error "No payment transaction found!"
  echo "Response:"
  echo "$TX_RESPONSE" | jq .
  exit 1
fi

TX_ID=$(echo "$TX_RESPONSE" | jq -r '.transactions[0].id')
TX_TYPE=$(echo "$TX_RESPONSE" | jq -r '.transactions[0].type')
TX_AMOUNT=$(echo "$TX_RESPONSE" | jq -r '.transactions[0].amount_atomic')
TX_HASH=$(echo "$TX_RESPONSE" | jq -r '.transactions[0].tx_hash')

if [ "$TX_TYPE" != "lightning_payment" ]; then
  print_error "Incorrect transaction type: $TX_TYPE"
  exit 1
fi

if [ "$TX_AMOUNT" != "100" ]; then
  print_error "Incorrect transaction amount: $TX_AMOUNT"
  exit 1
fi

print_success "Transaction created: $TX_ID"
print_success "Type: $TX_TYPE"
print_success "Amount: $TX_AMOUNT sats"
print_success "Tx Hash: ${TX_HASH:0:16}..."
echo ""

# =============================================================================
# Test 7: Health Check
# =============================================================================
print_test "Checking system health..."

HEALTH_RESPONSE=$(curl -s "$API_URL/health")

if [ $? -ne 0 ]; then
  print_error "Health endpoint unreachable"
  exit 1
fi

HEALTH_STATUS=$(echo "$HEALTH_RESPONSE" | jq -r '.status')
LN_STATUS=$(echo "$HEALTH_RESPONSE" | jq -r '.rails.LN.status' 2>/dev/null || echo "unknown")

print_success "Overall status: $HEALTH_STATUS"
if [ "$LN_STATUS" != "null" ] && [ "$LN_STATUS" != "unknown" ]; then
  print_success "LN rail status: $LN_STATUS"
fi
echo ""

# =============================================================================
# Test 8: Webhook Security
# =============================================================================
print_test "Testing webhook security (invalid token)..."

WEBHOOK_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$API_URL/rails/ln/webhook/INVALID_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $RAIL_TOKEN" \
  -d '{
    "checking_id": "test123",
    "payment_hash": "'$(printf '%064d' 0)'",
    "pending": 0,
    "amount": 1000
  }')

if [ "$WEBHOOK_RESPONSE" != "401" ]; then
  print_error "Webhook should reject invalid token (expected 401, got $WEBHOOK_RESPONSE)"
  exit 1
fi

print_success "Webhook rejected invalid token (401)"
echo ""

# =============================================================================
# Test 9: Webhook Input Validation
# =============================================================================
print_test "Testing webhook input validation..."

# We need the real webhook secret for this test
# Try to extract it from environment or skip
if [ -n "$LNBITS_WEBHOOK_SECRET" ]; then
  # Test invalid payload format (array)
  INVALID_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL/rails/ln/webhook/$LNBITS_WEBHOOK_SECRET" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $RAIL_TOKEN" \
  -d '[]')

  if [ "$INVALID_RESPONSE" != "400" ]; then
    print_error "Should reject array payload (expected 400, got $INVALID_RESPONSE)"
  else
    print_success "Array payload rejected (400)"
  fi

  # Test invalid checking_id format
  INVALID_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL/rails/ln/webhook/$LNBITS_WEBHOOK_SECRET" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $RAIL_TOKEN" \
  -d '{
      "checking_id": "../../../etc/passwd",
      "payment_hash": "abc",
      "pending": 0
    }')

  if [ "$INVALID_RESPONSE" != "400" ]; then
    print_error "Should reject invalid checking_id (expected 400, got $INVALID_RESPONSE)"
  else
    print_success "Invalid checking_id rejected (400)"
  fi
else
  print_info "Skipping detailed validation tests (LNBITS_WEBHOOK_SECRET not available)"
fi

echo ""

# =============================================================================
# Summary
# =============================================================================
print_header "Test Summary"

echo "Tests Run:    $TESTS_RUN"
echo -e "Tests Passed: ${GREEN}$TESTS_PASSED${NC}"
if [ $TESTS_FAILED -gt 0 ]; then
  echo -e "Tests Failed: ${RED}$TESTS_FAILED${NC}"
else
  echo -e "Tests Failed: ${GREEN}0${NC}"
fi
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
  echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║   All Tests Passed! ✓                ║${NC}"
  echo -e "${GREEN}║   LN Integration is Production Ready ║${NC}"
  echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
  exit 0
else
  echo -e "${RED}╔═══════════════════════════════════════╗${NC}"
  echo -e "${RED}║   Some Tests Failed ✗                ║${NC}"
  echo -e "${RED}║   Review errors above                ║${NC}"
  echo -e "${RED}╚═══════════════════════════════════════╝${NC}"
  exit 1
fi
