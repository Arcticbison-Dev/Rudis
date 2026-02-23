#!/bin/bash
set -e

echo "============================================"
echo " Altostratus Payments - Setup"
echo "============================================"
echo ""

ENV_FILE=".env"

if [ -f "$ENV_FILE" ]; then
  echo "Found existing .env file."
  read -p "Overwrite with fresh configuration? (y/N): " overwrite
  if [ "$overwrite" != "y" ] && [ "$overwrite" != "Y" ]; then
    echo "Keeping existing .env file."
    echo ""
  else
    cp "$ENV_FILE" "${ENV_FILE}.backup.$(date +%s)"
    echo "Backed up existing .env file."
  fi
fi

if [ ! -f "$ENV_FILE" ] || [ "$overwrite" = "y" ] || [ "$overwrite" = "Y" ]; then
  echo "Generating new .env from .env.example..."
  cp .env.example "$ENV_FILE"

  generate_secret() {
    openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p -c 64
  }

  ADMIN_API_TOKEN=$(generate_secret)
  RAIL_AUTH_TOKEN=$(generate_secret)
  SESSION_SECRET=$(generate_secret)
  ALT_WEBHOOK_SECRET=$(generate_secret)
  ADMIN_SIM_TOKEN=$(generate_secret)

  if [[ "$OSTYPE" == "darwin"* ]]; then
    SED_INPLACE="sed -i ''"
  else
    SED_INPLACE="sed -i"
  fi

  $SED_INPLACE "s|^ADMIN_API_TOKEN=.*|ADMIN_API_TOKEN=$ADMIN_API_TOKEN|" "$ENV_FILE"
  $SED_INPLACE "s|^RAIL_AUTH_TOKEN=.*|RAIL_AUTH_TOKEN=$RAIL_AUTH_TOKEN|" "$ENV_FILE"
  $SED_INPLACE "s|^SESSION_SECRET=.*|SESSION_SECRET=$SESSION_SECRET|" "$ENV_FILE"
  $SED_INPLACE "s|^ALT_WEBHOOK_SECRET=.*|ALT_WEBHOOK_SECRET=$ALT_WEBHOOK_SECRET|" "$ENV_FILE"
  $SED_INPLACE "s|^ADMIN_SIM_TOKEN=.*|ADMIN_SIM_TOKEN=$ADMIN_SIM_TOKEN|" "$ENV_FILE"

  echo "Generated security tokens."
fi

echo ""
echo "--- Checking prerequisites ---"

if command -v node &> /dev/null; then
  echo "[OK] Node.js $(node --version)"
else
  echo "[MISSING] Node.js is required. Install with: nix-env -iA nixpkgs.nodejs_20"
  exit 1
fi

if command -v psql &> /dev/null; then
  echo "[OK] PostgreSQL client available"
else
  echo "[WARN] psql not found - install postgresql client for database management"
fi

if [ -f "package.json" ]; then
  echo ""
  echo "--- Installing dependencies ---"
  npm install
fi

echo ""
echo "--- Database setup ---"
if [ -n "$DATABASE_URL" ]; then
  echo "DATABASE_URL is set. Pushing schema..."
  npx drizzle-kit push --force
  echo "[OK] Database schema applied."
else
  echo "[WARN] DATABASE_URL not set. Set it in .env, then run: npx drizzle-kit push"
fi

echo ""
echo "============================================"
echo " Setup complete!"
echo "============================================"
echo ""
echo "Next steps:"
echo "  1. Edit .env and set DATABASE_URL"
echo "  2. Enable at least one payment rail (ENABLE_LN, ENABLE_BTC, or ENABLE_XMR)"
echo "  3. Configure the chosen rail's settings"
echo "  4. Run: npm run dev"
echo ""
echo "For standalone deployment:"
echo "  docker-compose up -d"
echo ""
echo "For testing:"
echo "  npm run dev   (in one terminal)"
echo "  npx vitest run  (in another terminal)"
echo ""
