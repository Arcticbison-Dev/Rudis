import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { CopyButton } from "@/components/copy-button";
import { Badge } from "@/components/ui/badge";

export default function ApiDocs() {
  const baseUrl = window.location.origin;

  const endpoints = [
    {
      method: "POST",
      path: "/api/invoices",
      title: "Create Invoice",
      description: "Create a new crypto payment invoice",
      requestBody: {
        amount: "0.001",
        currency: "BTC",
        description: "Payment for services",
        paymentAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        expiresAt: "2025-12-31T23:59:59Z",
      },
      response: {
        id: "550e8400-e29b-41d4-a716-446655440000",
        amount: "0.001",
        currency: "BTC",
        description: "Payment for services",
        paymentAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        status: "pending",
        createdAt: "2025-11-04T12:00:00Z",
        paidAt: null,
        expiresAt: "2025-12-31T23:59:59Z",
      },
    },
    {
      method: "GET",
      path: "/api/invoices",
      title: "List Invoices",
      description: "Retrieve all invoices",
      response: [
        {
          id: "550e8400-e29b-41d4-a716-446655440000",
          amount: "0.001",
          currency: "BTC",
          description: "Payment for services",
          status: "pending",
          createdAt: "2025-11-04T12:00:00Z",
        },
      ],
    },
    {
      method: "GET",
      path: "/api/invoices/:id",
      title: "Get Invoice",
      description: "Retrieve a specific invoice by ID",
      response: {
        id: "550e8400-e29b-41d4-a716-446655440000",
        amount: "0.001",
        currency: "BTC",
        description: "Payment for services",
        paymentAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        status: "pending",
        createdAt: "2025-11-04T12:00:00Z",
      },
    },
    {
      method: "POST",
      path: "/api/webhooks/payment-confirmed",
      title: "Payment Confirmation Webhook",
      description: "Webhook endpoint for blockchain listeners to notify payment confirmations. Returns 400 error if invoice is expired - each payment must use a new invoice.",
      requestBody: {
        invoiceId: "550e8400-e29b-41d4-a716-446655440000",
        transactionId: "abc123def456...",
        confirmations: 6,
        blockHeight: 800000,
      },
      response: {
        success: true,
        message: "Payment confirmed and processed",
        transactionId: "abc123def456...",
      },
    },
    {
      method: "GET",
      path: "/api/invoices/:id/webhook-logs",
      title: "Get Webhook Logs",
      description: "Retrieve webhook delivery logs for an invoice",
      response: [
        {
          id: "log-id",
          invoiceId: "550e8400-e29b-41d4-a716-446655440000",
          url: "https://main.altostratus.app/webhooks/payment",
          status: "success",
          statusCode: "200",
          attempt: "1",
          createdAt: "2025-11-04T12:30:00Z",
        },
      ],
    },
    {
      method: "GET",
      path: "/api/invoices/:id/transactions",
      title: "Get Payment Transactions",
      description: "Retrieve blockchain transaction details for an invoice",
      response: [
        {
          id: "tx-id",
          invoiceId: "550e8400-e29b-41d4-a716-446655440000",
          transactionId: "abc123def456...",
          confirmations: "6",
          blockHeight: "800000",
          confirmedAt: "2025-11-04T12:30:00Z",
        },
      ],
    },
    {
      method: "POST",
      path: "/api/invoices/check-expired",
      title: "Check Expired Invoices",
      description: "Manual trigger to check and expire invoices. Can be called by external scheduler/cron.",
      response: {
        success: true,
        expiredCount: 2,
        message: "2 invoice(s) expired",
      },
    },
    {
      method: "POST",
      path: "/api/invoices/cleanup",
      title: "Cleanup Old Expired Invoices",
      description: "Purge expired invoices older than specified days (30-90 range enforced, default: 90). Can be called by external scheduler/cron.",
      requestBody: {
        daysOld: 90,
      },
      response: {
        success: true,
        purgedCount: 15,
        daysOld: 90,
        message: "15 expired invoice(s) purged",
      },
    },
    {
      method: "GET",
      path: "/api/fee-status",
      title: "Fee Collection Status",
      description: "Check whether automatic fee collection is enabled and whether the system is in good standing. Returns whether invoice creation is blocked due to overdue settlements.",
      response: {
        feeCollectionEnabled: true,
        systemInGoodStanding: true,
        invoiceCreationBlocked: false,
      },
    },
    {
      method: "GET",
      path: "/admin/fee-settlements",
      title: "List Fee Settlements",
      description: "List all fee settlements with status filtering. Requires ADMIN_API_TOKEN. Settlements are auto-created when accumulated fees exceed the threshold.",
      response: [
        {
          id: "settle-001",
          currency: "BTC",
          totalFeeAtomic: "15000",
          invoiceCount: 12,
          status: "pending",
          operatorAddress: "bc1q...",
          dueAt: "2026-03-25T00:00:00Z",
          createdAt: "2026-02-23T12:00:00Z",
          paidAt: null,
        },
      ],
    },
    {
      method: "POST",
      path: "/admin/fee-settlements/:id/mark-paid",
      title: "Mark Settlement as Paid",
      description: "Mark a pending or overdue settlement as paid. Requires ADMIN_API_TOKEN. Clears the overdue enforcement block on invoice creation.",
      response: {
        success: true,
        settlement: {
          id: "settle-001",
          status: "paid",
          paidAt: "2026-02-25T10:00:00Z",
        },
      },
    },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-center gap-4">
        <Link href="/">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight" data-testid="heading-api-docs">
            API Documentation
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            RESTful API for programmatic invoice management
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Base URL</CardTitle>
          <CardDescription>All API requests should be made to this base URL</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-muted px-4 py-2 rounded-md font-mono text-sm">
              {baseUrl}/api
            </code>
            <CopyButton value={`${baseUrl}/api`} />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <h2 className="text-xl md:text-2xl font-semibold">Endpoints</h2>
        
        {endpoints.map((endpoint, index) => (
          <Card key={index} className="border-l-4" data-testid={`endpoint-${endpoint.path.replace(/\//g, "-")}`}>
            <CardHeader>
              <div className="flex items-start gap-3 flex-wrap">
                <Badge
                  variant={endpoint.method === "GET" ? "secondary" : "default"}
                  className="font-mono text-xs shrink-0"
                >
                  {endpoint.method}
                </Badge>
                <code className="text-lg font-mono flex-1 break-all">
                  {endpoint.path}
                </code>
              </div>
              <CardTitle className="text-lg mt-2">{endpoint.title}</CardTitle>
              <CardDescription>{endpoint.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {endpoint.requestBody && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold">Request Body</h4>
                    <CopyButton value={JSON.stringify(endpoint.requestBody, null, 2)} />
                  </div>
                  <pre className="bg-muted p-4 rounded-md overflow-x-auto">
                    <code className="text-xs font-mono">
                      {JSON.stringify(endpoint.requestBody, null, 2)}
                    </code>
                  </pre>
                </div>
              )}
              
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold">Response</h4>
                  <CopyButton value={JSON.stringify(endpoint.response, null, 2)} />
                </div>
                <pre className="bg-muted p-4 rounded-md overflow-x-auto">
                  <code className="text-xs font-mono">
                    {JSON.stringify(endpoint.response, null, 2)}
                  </code>
                </pre>
              </div>

              {endpoint.method === "POST" && endpoint.path === "/api/invoices" && (
                <div className="pt-4 border-t">
                  <h4 className="text-sm font-semibold mb-2">Example cURL</h4>
                  <div className="relative">
                    <pre className="bg-muted p-4 rounded-md overflow-x-auto">
                      <code className="text-xs font-mono">
                        {`curl -X POST ${baseUrl}/api/invoices \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(endpoint.requestBody, null, 2)}'`}
                      </code>
                    </pre>
                    <div className="absolute top-2 right-2">
                      <CopyButton
                        value={`curl -X POST ${baseUrl}/api/invoices -H "Content-Type: application/json" -d '${JSON.stringify(endpoint.requestBody)}'`}
                      />
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Webhook Configuration</CardTitle>
          <CardDescription>
            Configure where payment notifications should be sent
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm">
            When an invoice is paid, Altostratus Payments will send a POST request to your configured webhook URL with HMAC-SHA256 signature for security.
          </p>
          <div className="space-y-2 mb-4">
            <h4 className="text-sm font-semibold">Security Headers</h4>
            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md p-3">
              <p className="text-xs font-medium text-blue-900 dark:text-blue-100 mb-1">X-Altostratus-Signature</p>
              <p className="text-xs text-blue-800 dark:text-blue-200">
                HMAC-SHA256 signature of the payload using ALT_WEBHOOK_SECRET. Verify this signature to ensure the webhook is authentic.
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">Webhook Payload (Minimal + Verification)</h4>
            <CopyButton
              value={JSON.stringify({
                invoiceId: "550e8400-e29b-41d4-a716-446655440000",
                status: "paid",
                amount: "0.001",
                currency: "BTC",
                timestamp: "2025-11-14T01:30:00.000Z",
              }, null, 2)}
            />
          </div>
          <pre className="bg-muted p-4 rounded-md overflow-x-auto">
            <code className="text-xs font-mono">
              {JSON.stringify({
                invoiceId: "550e8400-e29b-41d4-a716-446655440000",
                status: "paid",
                amount: "0.001",
                currency: "BTC",
                timestamp: "2025-11-14T01:30:00.000Z",
              }, null, 2)}
            </code>
          </pre>
          <p className="text-xs text-muted-foreground mt-2">
            This minimal payload allows you to verify that the payment matches your expected amount and currency (anti-fraud). The timestamp provides replay protection - reject webhooks older than 5 minutes. Query the Payments service API for additional details if needed.
          </p>
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Reliability Features</h4>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>• Persistent queue - survives server restarts</li>
              <li>• Automatic retries with exponential backoff</li>
              <li>• Up to 10 attempts or 24 hours (configurable)</li>
              <li>• Each retry signed with same HMAC secret</li>
              <li>• Minimal logging (counter + timestamp only)</li>
            </ul>
          </div>
          <p className="text-xs text-muted-foreground">
            Set ALTOSTRATUS_WEBHOOK_URL and ALT_WEBHOOK_SECRET environment variables.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Webhook Verification Examples</CardTitle>
          <CardDescription>
            Secure webhook verification in Node.js, Python, and Go
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Node.js / Express</h4>
              <CopyButton
                value={`const crypto = require('crypto');
const express = require('express');

app.post('/webhooks/payment', express.json(), async (req, res) => {
  const signature = req.headers['x-altostratus-signature'];
  const secret = process.env.ALT_WEBHOOK_SECRET;
  
  // 1. Verify HMAC signature (timing-safe)
  // Defensive: Check signature exists and is valid hex string
  if (!signature || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // Defensive: Validate request body exists
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Invalid request body' });
  }
  
  // Note: express.json() already parsed body. We re-serialize for HMAC verification.
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');
  
  if (!crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  )) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // 2. Extract and validate required fields
  const { invoiceId, status, amount, currency, timestamp } = req.body;
  if (!invoiceId || !status || !amount || !currency || !timestamp) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  // 3. Verify timestamp (replay protection - reject >5 min old)
  // Defensive: Check timestamp exists and is valid ISO-8601
  if (!timestamp || typeof timestamp !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid timestamp' });
  }
  const webhookTime = new Date(timestamp);
  if (isNaN(webhookTime.getTime())) {
    return res.status(400).json({ error: 'Invalid timestamp format' });
  }
  const webhookAge = Date.now() - webhookTime.getTime();
  if (webhookAge > 5 * 60 * 1000 || webhookAge < 0) {
    return res.status(400).json({ error: 'Webhook too old or from future' });
  }
  
  // 4. Check idempotency (prevent duplicate processing)
  const processed = await db.processedWebhooks.findOne({ invoiceId, timestamp });
  if (processed) {
    return res.json({ success: true, message: 'Already processed' });
  }
  
  // 5. Verify amount/currency match expected values (anti-fraud)
  const invoice = await db.invoices.findOne({ id: invoiceId });
  if (!invoice) {
    return res.status(404).json({ error: 'Invoice not found' });
  }
  
  if (invoice.amount !== amount || invoice.currency !== currency) {
    console.error(\`Payment mismatch: expected \${invoice.amount} \${invoice.currency}, got \${amount} \${currency}\`);
    return res.status(400).json({ error: 'Payment verification failed' });
  }
  
  // 6. Update your database (idempotent)
  await db.invoices.update({ id: invoiceId }, { status: 'paid' });
  await db.processedWebhooks.insert({ invoiceId, timestamp, processedAt: new Date() });
  await activateSubscription(invoiceId);
  
  res.json({ success: true });
});`}
              />
            </div>
            <pre className="bg-muted p-4 rounded-md overflow-x-auto">
              <code className="text-xs font-mono">
{`const crypto = require('crypto');
const express = require('express');

app.post('/webhooks/payment', express.json(), async (req, res) => {
  const signature = req.headers['x-altostratus-signature'];
  const secret = process.env.ALT_WEBHOOK_SECRET;
  
  // 1. Verify HMAC signature (timing-safe)
  // Defensive: Check signature exists and is valid hex string
  if (!signature || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // Defensive: Validate request body exists
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Invalid request body' });
  }
  
  // Note: express.json() already parsed body. We re-serialize for HMAC verification.
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');
  
  if (!crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  )) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // 2. Extract and validate required fields
  const { invoiceId, status, amount, currency, timestamp } = req.body;
  if (!invoiceId || !status || !amount || !currency || !timestamp) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  // 3. Verify timestamp (replay protection - reject >5 min old)
  // Defensive: Check timestamp exists and is valid ISO-8601
  if (!timestamp || typeof timestamp !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid timestamp' });
  }
  const webhookTime = new Date(timestamp);
  if (isNaN(webhookTime.getTime())) {
    return res.status(400).json({ error: 'Invalid timestamp format' });
  }
  const webhookAge = Date.now() - webhookTime.getTime();
  if (webhookAge > 5 * 60 * 1000 || webhookAge < 0) {
    return res.status(400).json({ error: 'Webhook too old or from future' });
  }
  
  // 4. Check idempotency (prevent duplicate processing)
  const processed = await db.processedWebhooks.findOne({ invoiceId, timestamp });
  if (processed) {
    return res.json({ success: true, message: 'Already processed' });
  }
  
  // 5. Verify amount/currency match expected values (anti-fraud)
  const invoice = await db.invoices.findOne({ id: invoiceId });
  if (!invoice) {
    return res.status(404).json({ error: 'Invoice not found' });
  }
  
  if (invoice.amount !== amount || invoice.currency !== currency) {
    console.error(\`Payment mismatch: expected \${invoice.amount} \${invoice.currency}, got \${amount} \${currency}\`);
    return res.status(400).json({ error: 'Payment verification failed' });
  }
  
  // 6. Update your database (idempotent)
  await db.invoices.update({ id: invoiceId }, { status: 'paid' });
  await db.processedWebhooks.insert({ invoiceId, timestamp, processedAt: new Date() });
  await activateSubscription(invoiceId);
  
  res.json({ success: true });
});`}
              </code>
            </pre>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Python / Flask</h4>
              <CopyButton
                value={`import os
import hmac
import hashlib
import json
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/webhooks/payment', methods=['POST'])
def handle_payment_webhook():
    signature = request.headers.get('X-Altostratus-Signature')
    secret = os.environ['ALT_WEBHOOK_SECRET']
    
    # 1. Verify HMAC signature (timing-safe)
    # Defensive: Check signature exists and is valid hex string (64 chars for SHA256)
    import re
    if not signature or not isinstance(signature, str) or not re.match(r'^[a-f0-9]{64}$', signature, re.IGNORECASE):
        return jsonify({'error': 'Invalid signature'}), 401
    
    body_bytes = request.get_data()
    expected_signature = hmac.new(
        secret.encode('utf-8'),
        body_bytes,
        hashlib.sha256
    ).hexdigest()
    
    if not hmac.compare_digest(signature, expected_signature):
        return jsonify({'error': 'Invalid signature'}), 401
    
    # 2. Extract and validate payload
    payload = request.get_json(silent=True)
    if not payload or not isinstance(payload, dict):
        return jsonify({'error': 'Invalid request body'}), 400
    
    invoice_id = payload.get('invoiceId')
    status = payload.get('status')
    amount = payload.get('amount')
    currency = payload.get('currency')
    timestamp = payload.get('timestamp')
    
    # Validate required fields exist
    if not all([invoice_id, status, amount, currency, timestamp]):
        return jsonify({'error': 'Missing required fields'}), 400
    
    # 3. Verify timestamp (replay protection - reject >5 min old)
    # Defensive: Check timestamp exists and is valid ISO-8601
    if not timestamp or not isinstance(timestamp, str):
        return jsonify({'error': 'Missing or invalid timestamp'}), 400
    
    from datetime import datetime, timezone
    try:
        webhook_time = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
    except (ValueError, AttributeError):
        return jsonify({'error': 'Invalid timestamp format'}), 400
    
    age_seconds = (datetime.now(timezone.utc) - webhook_time).total_seconds()
    if age_seconds > 5 * 60 or age_seconds < 0:
        return jsonify({'error': 'Webhook too old or from future'}), 400
    
    # 4. Check idempotency (prevent duplicate processing)
    processed = db.processedWebhooks.find_one({'invoiceId': invoice_id, 'timestamp': timestamp})
    if processed:
        return jsonify({'success': True, 'message': 'Already processed'})
    
    # 5. Verify amount/currency match expected values (anti-fraud)
    invoice = db.invoices.find_one({'id': invoice_id})
    if not invoice:
        return jsonify({'error': 'Invoice not found'}), 404
    
    if invoice['amount'] != amount or invoice['currency'] != currency:
        print(f'Payment mismatch: expected {invoice["amount"]} {invoice["currency"]}, got {amount} {currency}')
        return jsonify({'error': 'Payment verification failed'}), 400
    
    # 6. Update your database (idempotent)
    db.invoices.update_one({'id': invoice_id}, {'$set': {'status': 'paid'}})
    db.processedWebhooks.insert_one({'invoiceId': invoice_id, 'timestamp': timestamp, 'processedAt': datetime.now(timezone.utc)})
    activate_subscription(invoice_id)
    
    return jsonify({'success': True})`}
              />
            </div>
            <pre className="bg-muted p-4 rounded-md overflow-x-auto">
              <code className="text-xs font-mono">
{`import os
import hmac
import hashlib
import json
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/webhooks/payment', methods=['POST'])
def handle_payment_webhook():
    signature = request.headers.get('X-Altostratus-Signature')
    secret = os.environ['ALT_WEBHOOK_SECRET']
    
    # 1. Verify HMAC signature (timing-safe)
    # Defensive: Check signature exists and is valid hex string (64 chars for SHA256)
    import re
    if not signature or not isinstance(signature, str) or not re.match(r'^[a-f0-9]{64}$', signature, re.IGNORECASE):
        return jsonify({'error': 'Invalid signature'}), 401
    
    body_bytes = request.get_data()
    expected_signature = hmac.new(
        secret.encode('utf-8'),
        body_bytes,
        hashlib.sha256
    ).hexdigest()
    
    if not hmac.compare_digest(signature, expected_signature):
        return jsonify({'error': 'Invalid signature'}), 401
    
    # 2. Extract and validate payload
    payload = request.get_json(silent=True)
    if not payload or not isinstance(payload, dict):
        return jsonify({'error': 'Invalid request body'}), 400
    
    invoice_id = payload.get('invoiceId')
    status = payload.get('status')
    amount = payload.get('amount')
    currency = payload.get('currency')
    timestamp = payload.get('timestamp')
    
    # Validate required fields exist
    if not all([invoice_id, status, amount, currency, timestamp]):
        return jsonify({'error': 'Missing required fields'}), 400
    
    # 3. Verify timestamp (replay protection - reject >5 min old)
    # Defensive: Check timestamp exists and is valid ISO-8601
    if not timestamp or not isinstance(timestamp, str):
        return jsonify({'error': 'Missing or invalid timestamp'}), 400
    
    from datetime import datetime, timezone
    try:
        webhook_time = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
    except (ValueError, AttributeError):
        return jsonify({'error': 'Invalid timestamp format'}), 400
    
    age_seconds = (datetime.now(timezone.utc) - webhook_time).total_seconds()
    if age_seconds > 5 * 60 or age_seconds < 0:
        return jsonify({'error': 'Webhook too old or from future'}), 400
    
    # 4. Check idempotency (prevent duplicate processing)
    processed = db.processedWebhooks.find_one({'invoiceId': invoice_id, 'timestamp': timestamp})
    if processed:
        return jsonify({'success': True, 'message': 'Already processed'})
    
    # 5. Verify amount/currency match expected values (anti-fraud)
    invoice = db.invoices.find_one({'id': invoice_id})
    if not invoice:
        return jsonify({'error': 'Invoice not found'}), 404
    
    if invoice['amount'] != amount or invoice['currency'] != currency:
        print(f'Payment mismatch: expected {invoice["amount"]} {invoice["currency"]}, got {amount} {currency}')
        return jsonify({'error': 'Payment verification failed'}), 400
    
    # 6. Update your database (idempotent)
    db.invoices.update_one({'id': invoice_id}, {'$set': {'status': 'paid'}})
    db.processedWebhooks.insert_one({'invoiceId': invoice_id, 'timestamp': timestamp, 'processedAt': datetime.now(timezone.utc)})
    activate_subscription(invoice_id)
    
    return jsonify({'success': True})`}
              </code>
            </pre>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Go / Gin</h4>
              <CopyButton
                value={`package main

import (
    "crypto/hmac"
    "crypto/sha256"
    "crypto/subtle"
    "encoding/hex"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "os"
    
    "github.com/gin-gonic/gin"
)

type WebhookPayload struct {
    InvoiceID string \`json:"invoiceId"\`
    Status    string \`json:"status"\`
    Amount    string \`json:"amount"\`
    Currency  string \`json:"currency"\`
    Timestamp string \`json:"timestamp"\`
}

func HandlePaymentWebhook(c *gin.Context) {
    signature := c.GetHeader("X-Altostratus-Signature")
    secret := os.Getenv("ALT_WEBHOOK_SECRET")
    
    // 1. Read and verify HMAC signature (timing-safe)
    // Defensive: Check signature exists and is valid hex string (64 chars for SHA256)
    if signature == "" || len(signature) != 64 {
        c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid signature"})
        return
    }
    // Validate hex characters
    if _, err := hex.DecodeString(signature); err != nil {
        c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid signature"})
        return
    }
    
    bodyBytes, _ := io.ReadAll(c.Request.Body)
    
    mac := hmac.New(sha256.New, []byte(secret))
    mac.Write(bodyBytes)
    expectedSignature := hex.EncodeToString(mac.Sum(nil))
    
    if subtle.ConstantTimeCompare([]byte(signature), []byte(expectedSignature)) != 1 {
        c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid signature"})
        return
    }
    
    // 2. Parse and validate payload
    var payload WebhookPayload
    if err := json.Unmarshal(bodyBytes, &payload); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON"})
        return
    }
    
    // Validate required fields exist
    if payload.InvoiceID == "" || payload.Status == "" || 
       payload.Amount == "" || payload.Currency == "" || payload.Timestamp == "" {
        c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required fields"})
        return
    }
    
    // 3. Verify timestamp (replay protection - reject >5 min old)
    webhookTime, err := time.Parse(time.RFC3339, payload.Timestamp)
    if err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid timestamp"})
        return
    }
    if time.Since(webhookTime) > 5*time.Minute {
        c.JSON(http.StatusBadRequest, gin.H{"error": "Webhook too old"})
        return
    }
    
    // 4. Check idempotency (prevent duplicate processing)
    processed, _ := db.FindProcessedWebhook(payload.InvoiceID, payload.Timestamp)
    if processed {
        c.JSON(http.StatusOK, gin.H{"success": true, "message": "Already processed"})
        return
    }
    
    // 5. Verify amount/currency match expected values (anti-fraud)
    invoice, err := db.FindInvoice(payload.InvoiceID)
    if err != nil {
        c.JSON(http.StatusNotFound, gin.H{"error": "Invoice not found"})
        return
    }
    
    if invoice.Amount != payload.Amount || invoice.Currency != payload.Currency {
        fmt.Printf("Payment mismatch: expected %s %s, got %s %s\\n",
            invoice.Amount, invoice.Currency, payload.Amount, payload.Currency)
        c.JSON(http.StatusBadRequest, gin.H{"error": "Payment verification failed"})
        return
    }
    
    // 6. Update your database (idempotent)
    db.UpdateInvoice(payload.InvoiceID, "paid")
    db.SaveProcessedWebhook(payload.InvoiceID, payload.Timestamp)
    ActivateSubscription(payload.InvoiceID)
    
    c.JSON(http.StatusOK, gin.H{"success": true})
}`}
              />
            </div>
            <pre className="bg-muted p-4 rounded-md overflow-x-auto">
              <code className="text-xs font-mono">
{`package main

import (
    "crypto/hmac"
    "crypto/sha256"
    "crypto/subtle"
    "encoding/hex"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "os"
    
    "github.com/gin-gonic/gin"
)

type WebhookPayload struct {
    InvoiceID string \`json:"invoiceId"\`
    Status    string \`json:"status"\`
    Amount    string \`json:"amount"\`
    Currency  string \`json:"currency"\`
    Timestamp string \`json:"timestamp"\`
}

func HandlePaymentWebhook(c *gin.Context) {
    signature := c.GetHeader("X-Altostratus-Signature")
    secret := os.Getenv("ALT_WEBHOOK_SECRET")
    
    // 1. Read and verify HMAC signature (timing-safe)
    // Defensive: Check signature exists and is valid hex string (64 chars for SHA256)
    if signature == "" || len(signature) != 64 {
        c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid signature"})
        return
    }
    // Validate hex characters
    if _, err := hex.DecodeString(signature); err != nil {
        c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid signature"})
        return
    }
    
    bodyBytes, _ := io.ReadAll(c.Request.Body)
    
    mac := hmac.New(sha256.New, []byte(secret))
    mac.Write(bodyBytes)
    expectedSignature := hex.EncodeToString(mac.Sum(nil))
    
    if subtle.ConstantTimeCompare([]byte(signature), []byte(expectedSignature)) != 1 {
        c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid signature"})
        return
    }
    
    // 2. Parse and validate payload
    var payload WebhookPayload
    if err := json.Unmarshal(bodyBytes, &payload); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON"})
        return
    }
    
    // Validate required fields exist
    if payload.InvoiceID == "" || payload.Status == "" || 
       payload.Amount == "" || payload.Currency == "" || payload.Timestamp == "" {
        c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required fields"})
        return
    }
    
    // 3. Verify timestamp (replay protection - reject >5 min old)
    webhookTime, err := time.Parse(time.RFC3339, payload.Timestamp)
    if err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid timestamp"})
        return
    }
    if time.Since(webhookTime) > 5*time.Minute {
        c.JSON(http.StatusBadRequest, gin.H{"error": "Webhook too old"})
        return
    }
    
    // 4. Check idempotency (prevent duplicate processing)
    processed, _ := db.FindProcessedWebhook(payload.InvoiceID, payload.Timestamp)
    if processed {
        c.JSON(http.StatusOK, gin.H{"success": true, "message": "Already processed"})
        return
    }
    
    // 5. Verify amount/currency match expected values (anti-fraud)
    invoice, err := db.FindInvoice(payload.InvoiceID)
    if err != nil {
        c.JSON(http.StatusNotFound, gin.H{"error": "Invoice not found"})
        return
    }
    
    if invoice.Amount != payload.Amount || invoice.Currency != payload.Currency {
        fmt.Printf("Payment mismatch: expected %s %s, got %s %s\\n",
            invoice.Amount, invoice.Currency, payload.Amount, payload.Currency)
        c.JSON(http.StatusBadRequest, gin.H{"error": "Payment verification failed"})
        return
    }
    
    // 6. Update your database (idempotent)
    db.UpdateInvoice(payload.InvoiceID, "paid")
    db.SaveProcessedWebhook(payload.InvoiceID, payload.Timestamp)
    ActivateSubscription(payload.InvoiceID)
    
    c.JSON(http.StatusOK, gin.H{"success": true})
}`}
              </code>
            </pre>
          </div>

          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md p-4 mt-4">
            <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-100 mb-2">Security Best Practices (REQUIRED)</h4>
            <ul className="text-xs text-amber-800 dark:text-amber-200 space-y-1">
              <li>🔒 <strong>REQUIRED:</strong> Verify HMAC signature using timing-safe comparison</li>
              <li>🔒 <strong>REQUIRED:</strong> Verify timestamp - reject webhooks older than 5 minutes (replay protection)</li>
              <li>🔒 <strong>REQUIRED:</strong> Implement idempotency - store processed (invoiceId, timestamp) pairs to prevent duplicate processing</li>
              <li>🔒 <strong>REQUIRED:</strong> Verify amount and currency match your database (anti-fraud/anti-tampering)</li>
              <li>✓ Use HTTPS only - never expose webhook endpoints over HTTP</li>
              <li>✓ Store ALT_WEBHOOK_SECRET securely (environment variables, secrets manager)</li>
              <li>✓ Return 200 OK quickly - process async if needed to avoid retries</li>
              <li>✓ Log webhook processing for audit trail (timestamp, invoiceId, result)</li>
            </ul>
            <p className="text-xs text-amber-800 dark:text-amber-200 mt-2 font-semibold">
              ⚠️ Without idempotency checking, your system will process the same payment multiple times during retries, potentially granting duplicate subscriptions or credits.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Environment Variables</CardTitle>
          <CardDescription>
            Configure timeouts, retry behavior, and cleanup settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4">
            <div>
              <h4 className="text-sm font-semibold mb-1">WEBHOOK_TIMEOUT_MS</h4>
              <p className="text-xs text-muted-foreground">Webhook timeout in milliseconds (default: 10000)</p>
            </div>
            <div>
              <h4 className="text-sm font-semibold mb-1">ALT_WEBHOOK_SECRET</h4>
              <p className="text-xs text-muted-foreground">Secret for HMAC-SHA256 signing of webhooks</p>
            </div>
            <div>
              <h4 className="text-sm font-semibold mb-1">WEBHOOK_MAX_ATTEMPTS</h4>
              <p className="text-xs text-muted-foreground">Maximum webhook retry attempts (default: 10)</p>
            </div>
            <div>
              <h4 className="text-sm font-semibold mb-1">WEBHOOK_MAX_AGE_HOURS</h4>
              <p className="text-xs text-muted-foreground">Auto-cleanup failed webhooks after hours (default: 24)</p>
            </div>
            <div>
              <h4 className="text-sm font-semibold mb-1">WEBHOOK_RETRY_DELAY_1/2/3</h4>
              <p className="text-xs text-muted-foreground">Retry delays in ms for attempts 1, 2, 3 (default: 1000, 3000, 9000)</p>
            </div>
            <div>
              <h4 className="text-sm font-semibold mb-1">VITE_EXPIRING_SOON_HOURS</h4>
              <p className="text-xs text-muted-foreground">Hours before expiration to show warning (default: 1)</p>
            </div>
            <div>
              <h4 className="text-sm font-semibold mb-1">CLEANUP_EXPIRED_DAYS</h4>
              <p className="text-xs text-muted-foreground">Days to keep expired invoices before purging (default: 90)</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scheduled Jobs</CardTitle>
          <CardDescription>
            Recommended cron jobs for automated maintenance
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h4 className="text-sm font-semibold mb-2">Daily Expiration Check</h4>
            <p className="text-xs text-muted-foreground mb-2">Run every hour to check and expire invoices:</p>
            <pre className="bg-muted p-3 rounded-md overflow-x-auto">
              <code className="text-xs font-mono">
                {`0 * * * * curl -X POST ${baseUrl}/api/invoices/check-expired`}
              </code>
            </pre>
          </div>
          <div>
            <h4 className="text-sm font-semibold mb-2">Daily Cleanup Job</h4>
            <p className="text-xs text-muted-foreground mb-2">Run once per day to purge old expired invoices:</p>
            <pre className="bg-muted p-3 rounded-md overflow-x-auto">
              <code className="text-xs font-mono">
                {`0 2 * * * curl -X POST ${baseUrl}/api/invoices/cleanup \\
  -H "Content-Type: application/json" \\
  -d '{"daysOld": 90}'`}
              </code>
            </pre>
          </div>
          <div>
            <h4 className="text-sm font-semibold mb-2">Webhook Queue Processing (Optional)</h4>
            <p className="text-xs text-muted-foreground mb-2">Process pending webhooks manually (automatic by default every 5 seconds):</p>
            <pre className="bg-muted p-3 rounded-md overflow-x-auto">
              <code className="text-xs font-mono">
                {`*/5 * * * * curl -X POST ${baseUrl}/api/webhooks/process-queue`}
              </code>
            </pre>
          </div>
          <div>
            <h4 className="text-sm font-semibold mb-2">Webhook Cleanup (Optional)</h4>
            <p className="text-xs text-muted-foreground mb-2">Clean up old failed webhooks manually (automatic every hour):</p>
            <pre className="bg-muted p-3 rounded-md overflow-x-auto">
              <code className="text-xs font-mono">
                {`0 * * * * curl -X POST ${baseUrl}/api/webhooks/cleanup`}
              </code>
            </pre>
          </div>
          <p className="text-xs text-muted-foreground">
            Note: Webhook processing and cleanup run automatically. These manual endpoints are optional for external schedulers.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
