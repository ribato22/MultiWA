#!/bin/bash
# ============================================
# MultiWA Webhook Test Script
# ============================================
# Tests webhook delivery with HMAC signature verification
#
# Usage:
#   ./scripts/test-webhook.sh [OPTIONS]
#
# Options:
#   -u URL     Webhook listener URL (default: http://localhost:9999/webhook)
#   -k KEY     API key for authentication
#   -p ID      Profile ID to use
#   -e EVENT   Event type (default: message.incoming)
#
# Prerequisites:
#   1. Create an API key in the admin dashboard (API Keys page)
#   2. Create a webhook in the admin dashboard (Webhooks page)
#   3. Set up a webhook listener (e.g., webhook.site or local server)
# ============================================

set -e

# Default values
API_BASE="http://localhost:3000/api/v1"
WEBHOOK_URL=""
API_KEY=""
PROFILE_ID=""
EVENT="message.incoming"

# Parse arguments
while getopts "u:k:p:e:h" opt; do
  case $opt in
    u) WEBHOOK_URL="$OPTARG" ;;
    k) API_KEY="$OPTARG" ;;
    p) PROFILE_ID="$OPTARG" ;;
    e) EVENT="$OPTARG" ;;
    h)
      echo "Usage: $0 [-u webhook_url] [-k api_key] [-p profile_id] [-e event]"
      echo ""
      echo "Options:"
      echo "  -u  Webhook listener URL"
      echo "  -k  API key for authentication"
      echo "  -p  Profile ID"
      echo "  -e  Event type (default: message.incoming)"
      exit 0
      ;;
    *) echo "Invalid option: -$OPTARG" >&2; exit 1 ;;
  esac
done

# Color output helpers
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}  MultiWA Webhook Test Script${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""

# ---- Step 1: Check authentication ----
if [ -z "$API_KEY" ]; then
  echo -e "${YELLOW}No API key provided. Trying JWT token...${NC}"
  
  # Try to get JWT token
  echo -n "Email: "
  read EMAIL
  echo -n "Password: "
  read -s PASSWORD
  echo ""

  LOGIN_RESPONSE=$(curl -s -X POST "$API_BASE/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\": \"$EMAIL\", \"password\": \"$PASSWORD\"}")
  
  TOKEN=$(echo "$LOGIN_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null)
  
  if [ -z "$TOKEN" ]; then
    echo -e "${RED}✗ Login failed. Please check credentials.${NC}"
    echo "Response: $LOGIN_RESPONSE"
    exit 1
  fi
  
  AUTH_HEADER="Authorization: Bearer $TOKEN"
  echo -e "${GREEN}✓ Logged in successfully${NC}"
else
  AUTH_HEADER="X-API-Key: $API_KEY"
  echo -e "${GREEN}✓ Using API key: ${API_KEY:0:12}...${NC}"
fi

# ---- Step 2: List profiles ----
echo ""
echo -e "${CYAN}Fetching profiles...${NC}"

PROFILES=$(curl -s "$API_BASE/profiles" -H "$AUTH_HEADER")
echo "$PROFILES" | python3 -c "
import sys, json
data = json.load(sys.stdin)
profiles = data if isinstance(data, list) else data.get('profiles', data.get('data', []))
for p in profiles:
    status = p.get('status', 'unknown')
    icon = '🟢' if status == 'connected' else '🔴'
    name = p.get('displayName') or p.get('name') or 'Unnamed'
    print(f\"  {icon} {p['id'][:8]}... - {name} ({status})\")
" 2>/dev/null || echo "  Failed to parse profiles"

# ---- Step 3: List webhooks ----
echo ""
echo -e "${CYAN}Fetching webhooks...${NC}"

WEBHOOKS=$(curl -s "$API_BASE/webhooks" -H "$AUTH_HEADER")
echo "$WEBHOOKS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
webhooks = data if isinstance(data, list) else data.get('webhooks', data.get('data', []))
if not webhooks:
    print('  No webhooks configured. Create one in the admin dashboard.')
else:
    for w in webhooks:
        enabled = '✓' if w.get('enabled') else '✗'
        events = ', '.join(w.get('events', []))
        print(f\"  [{enabled}] {w['id'][:8]}... → {w['url']}\")
        print(f\"      Events: {events}\")
" 2>/dev/null || echo "  Failed to parse webhooks"

# ---- Step 4: Test webhook delivery ----
echo ""
echo -e "${CYAN}Testing webhook delivery...${NC}"

# Pick first webhook if available
WEBHOOK_ID=$(echo "$WEBHOOKS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
webhooks = data if isinstance(data, list) else data.get('webhooks', data.get('data', []))
if webhooks:
    print(webhooks[0]['id'])
" 2>/dev/null)

if [ -z "$WEBHOOK_ID" ]; then
  echo -e "${RED}✗ No webhooks found. Create one first.${NC}"
  echo ""
  echo "To create a webhook via API:"
  echo "  curl -X POST $API_BASE/webhooks \\"
  echo "    -H '$AUTH_HEADER' \\"
  echo "    -H 'Content-Type: application/json' \\"
  echo "    -d '{\"profileId\": \"YOUR_PROFILE_ID\", \"url\": \"https://webhook.site/your-url\", \"events\": [\"message.incoming\", \"message.outgoing\"]}'"
  exit 1
fi

echo -e "  Testing webhook ${WEBHOOK_ID:0:8}..."

TEST_RESULT=$(curl -s -X POST "$API_BASE/webhooks/$WEBHOOK_ID/test" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{}')

echo "$TEST_RESULT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
if data.get('success'):
    print('  ✓ Test webhook delivered successfully!')
else:
    print(f\"  ✗ Test failed: {data.get('message', 'Unknown error')}\")
" 2>/dev/null || echo "  Response: $TEST_RESULT"

# ---- Step 5: HMAC Verification Example ----
echo ""
echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}  HMAC Signature Verification Guide${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""
echo "When receiving webhooks, verify the signature:"
echo ""
echo -e "${YELLOW}Node.js Example:${NC}"
cat << 'NODEJS'
  const crypto = require('crypto');

  function verifyWebhook(req) {
    const signature = req.headers['x-multiwa-signature'];
    const event = req.headers['x-multiwa-event'];
    const body = JSON.stringify(req.body);
    
    const expected = 'sha256=' + crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(body)
      .digest('hex');
    
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  }
NODEJS
echo ""
echo -e "${YELLOW}Python Example:${NC}"
cat << 'PYTHON'
  import hmac, hashlib

  def verify_webhook(headers, body, secret):
      signature = headers.get('X-MultiWA-Signature', '')
      expected = 'sha256=' + hmac.new(
          secret.encode(), body.encode(), hashlib.sha256
      ).hexdigest()
      return hmac.compare_digest(signature, expected)
PYTHON
echo ""
echo -e "${GREEN}Done!${NC}"
