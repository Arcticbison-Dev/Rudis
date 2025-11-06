import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

const app = express();
app.use(express.json());

// ==========================================
// CONFIGURATION
// ==========================================

const LND_URL = process.env.LN_REST_URL || '';
const MACAROON = process.env.LN_MACAROON_HEX || '';
const PAYMENTS_URL = process.env.PAYMENTS_SERVICE_URL || '';
const RAIL_TOKEN = process.env.RAIL_AUTH_TOKEN || '';
const EXPIRY_SEC = parseInt(process.env.LN_INVOICE_EXPIRY_SEC || '1200', 10);
const ENABLE_MPP = process.env.LN_ENABLE_MPP !== 'false';
const PORT = parseInt(process.env.PORT || '5001', 10);

// Validate critical configuration on startup
const missingVars: string[] = [];
if (!LND_URL) missingVars.push('LN_REST_URL');
if (!MACAROON) missingVars.push('LN_MACAROON_HEX');
if (!PAYMENTS_URL) missingVars.push('PAYMENTS_SERVICE_URL');
if (!RAIL_TOKEN) missingVars.push('RAIL_AUTH_TOKEN');

const configValid = missingVars.length === 0;

// ==========================================
// SCHEMAS (Zod Validation)
// ==========================================

const createInvoiceSchema = z.object({
  invoiceId: z.string().uuid(),
  amountMsat: z.number().int().positive().max(21_000_000_00_000_000), // 21M BTC in msat
  memo: z.string().max(639), // LND memo limit
});

const lndInvoiceResponseSchema = z.object({
  r_hash: z.string(),
  payment_request: z.string(),
  add_index: z.string().optional(),
});

// ==========================================
// RATE LIMITING
// ==========================================

const rateLimitStore = new Map<string, number[]>();

function rateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const timestamps = rateLimitStore.get(key) || [];
    
    // Remove old timestamps
    const validTimestamps = timestamps.filter(t => now - t < windowMs);
    
    if (validTimestamps.length >= maxRequests) {
      console.log(JSON.stringify({
        level: 'warn',
        event: 'rate_limit_exceeded',
        ip: key,
        rail: 'ln'
      }));
      return res.status(429).json({ error: 'Too many requests' });
    }
    
    validTimestamps.push(now);
    rateLimitStore.set(key, validTimestamps);
    next();
  };
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

async function checkLndConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${LND_URL}/getinfo`, {
      headers: { 'Grpc-Metadata-macaroon': MACAROON }
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}

function logStructured(level: string, event: string, data: any = {}) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    rail: 'ln',
    event,
    ...data
  }));
}

// ==========================================
// ENDPOINTS
// ==========================================

// Health Check Endpoint
app.get('/health', async (req: Request, res: Response) => {
  // Report configuration error in health check
  if (!configValid) {
    logStructured('error', 'health_check', { 
      status: 'misconfigured',
      missingVars
    });
    return res.status(503).json({
      status: 'misconfigured',
      rail: 'ln',
      timestamp: new Date().toISOString(),
      error: 'Missing required environment variables',
      missingVars,
      lndConnected: false,
      mppEnabled: ENABLE_MPP
    });
  }

  const lndConnected = await checkLndConnection();
  const status = lndConnected ? 'healthy' : 'degraded';
  
  logStructured('info', 'health_check', { status, lndConnected });
  
  res.status(lndConnected ? 200 : 503).json({
    status,
    rail: 'ln',
    timestamp: new Date().toISOString(),
    lndConnected,
    mppEnabled: ENABLE_MPP
  });
});

// Create Lightning Invoice Endpoint
app.post(
  '/ln/create',
  rateLimit(10, 60000), // 10 requests per minute
  async (req: Request, res: Response) => {
    // Reject requests if configuration is invalid
    if (!configValid) {
      logStructured('error', 'config_error', { 
        event: 'invoice_create_rejected',
        reason: 'missing_configuration'
      });
      return res.status(503).json({
        error: 'Service misconfigured',
        message: 'Missing required environment variables. Service cannot create invoices.'
      });
    }

    try {
      // Validate input with Zod
      const { invoiceId, amountMsat, memo } = createInvoiceSchema.parse(req.body);
      
      logStructured('info', 'invoice_create_requested', { invoiceId });
      
      // Create invoice via LND REST API
      const lndPayload = {
        value_msat: amountMsat.toString(),
        memo,
        expiry: EXPIRY_SEC.toString(),
      };
      
      const lndResponse = await fetch(`${LND_URL}/invoices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Grpc-Metadata-macaroon': MACAROON
        },
        body: JSON.stringify(lndPayload)
      });
      
      if (!lndResponse.ok) {
        const errorText = await lndResponse.text();
        logStructured('error', 'lnd_invoice_failed', {
          invoiceId,
          status: lndResponse.status,
          error: errorText.substring(0, 200)
        });
        return res.status(502).json({
          error: 'LND invoice creation failed',
          message: 'Unable to create Lightning invoice'
        });
      }
      
      const lndData = await lndResponse.json();
      const validated = lndInvoiceResponseSchema.parse(lndData);
      
      logStructured('info', 'invoice_created', {
        invoiceId,
        paymentHash: validated.r_hash.substring(0, 16) + '...'
      });
      
      // Return BOLT11 synchronously to payments service
      res.json({
        invoiceId,
        bolt11: validated.payment_request,
        paymentHash: validated.r_hash,
        expiresAt: new Date(Date.now() + EXPIRY_SEC * 1000).toISOString()
      });
      
      // Start monitoring this invoice (asynchronous)
      monitorInvoiceSettlement(invoiceId, validated.r_hash);
      
    } catch (error) {
      if (error instanceof z.ZodError) {
        logStructured('warn', 'validation_error', {
          errors: error.errors
        });
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors
        });
      }
      
      logStructured('error', 'invoice_create_error', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ==========================================
// INVOICE SETTLEMENT MONITORING
// ==========================================

async function monitorInvoiceSettlement(invoiceId: string, rHash: string) {
  try {
    // Poll invoice status every 2 seconds (simple approach)
    // Production: Use LND subscription streams for real-time updates
    const checkInterval = setInterval(async () => {
      try {
        const response = await fetch(
          `${LND_URL}/invoice/${rHash}`,
          { headers: { 'Grpc-Metadata-macaroon': MACAROON } }
        );
        
        if (!response.ok) {
          clearInterval(checkInterval);
          return;
        }
        
        const invoice: any = await response.json();
        
        // Check if invoice is settled
        if (invoice.state === 'SETTLED') {
          clearInterval(checkInterval);
          await handleInvoiceSettled(invoiceId, rHash);
        }
        
        // Check if invoice expired
        if (invoice.state === 'CANCELED' || invoice.state === 'EXPIRED') {
          clearInterval(checkInterval);
          logStructured('info', 'invoice_expired', { invoiceId });
        }
        
      } catch (error) {
        logStructured('error', 'monitor_error', {
          invoiceId,
          error: error instanceof Error ? error.message : 'Unknown'
        });
      }
    }, 2000);
    
    // Stop monitoring after expiry + 5 minutes
    setTimeout(() => {
      clearInterval(checkInterval);
    }, (EXPIRY_SEC + 300) * 1000);
    
  } catch (error) {
    logStructured('error', 'monitor_setup_failed', {
      invoiceId,
      error: error instanceof Error ? error.message : 'Unknown'
    });
  }
}

async function handleInvoiceSettled(invoiceId: string, paymentHash: string) {
  try {
    logStructured('info', 'invoice_settled', { invoiceId });
    
    // Send callback to payments service
    // CRITICAL: Use correct schema matching paymentConfirmationSchema
    const callbackPayload = {
      invoiceId,
      transactionId: paymentHash, // Payment hash as transaction ID
      confirmations: 0, // Lightning is instant (0-conf)
      blockHeight: null // Not applicable for Lightning
    };
    
    const callbackResponse = await fetch(
      `${PAYMENTS_URL}/api/rails/ln/settled`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RAIL_TOKEN}`
        },
        body: JSON.stringify(callbackPayload),
        signal: AbortSignal.timeout(10000) // 10 second timeout
      }
    );
    
    if (callbackResponse.ok) {
      logStructured('info', 'callback_success', { invoiceId });
    } else {
      const errorText = await callbackResponse.text();
      logStructured('error', 'callback_failed', {
        invoiceId,
        status: callbackResponse.status,
        error: errorText.substring(0, 200)
      });
    }
    
  } catch (error) {
    logStructured('error', 'callback_error', {
      invoiceId,
      error: error instanceof Error ? error.message : 'Unknown'
    });
    // TODO: Implement retry logic with exponential backoff
  }
}

// ==========================================
// STARTUP
// ==========================================

app.listen(PORT, async () => {
  // Check configuration validity
  if (!configValid) {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║           rail-ln - Lightning Network Service            ║');
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log('║ Port:        ' + PORT.toString().padEnd(46) + '║');
    console.log('║ Status:      ✗ CONFIGURATION ERROR                       ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.error('');
    console.error('ERROR: Missing required environment variables:');
    missingVars.forEach(v => console.error(`  - ${v}`));
    console.error('');
    console.error('Service started but will reject all requests until configured.');
    console.error('See rail-ln/README.md or DEPLOYMENT.md for setup instructions.');
    console.error('');
    
    logStructured('error', 'startup_failed', {
      message: 'Missing required environment variables',
      missingVars
    });
    return;
  }

  const lndConnected = await checkLndConnection();
  
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║           rail-ln - Lightning Network Service            ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log(`║ Port:        ${PORT}                                           ║`);
  console.log(`║ LND Status:  ${lndConnected ? '✓ Connected' : '✗ DISCONNECTED'}                                    ║`);
  console.log(`║ MPP:         ${ENABLE_MPP ? '✓ Enabled' : '✗ Disabled'}                                     ║`);
  console.log('╚═══════════════════════════════════════════════════════════╝');
  
  if (!lndConnected) {
    logStructured('error', 'startup_warning', {
      message: 'LND connection failed - service degraded'
    });
  }
  
  logStructured('info', 'service_started', { port: PORT });
});
