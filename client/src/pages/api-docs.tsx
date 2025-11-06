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
            When an invoice is paid, Altostratus Payments will send a POST request to your configured webhook URL with the following payload:
          </p>
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">Webhook Payload</h4>
            <CopyButton
              value={JSON.stringify({
                invoiceId: "550e8400-e29b-41d4-a716-446655440000",
                amount: "0.001",
                currency: "BTC",
                status: "paid",
                paidAt: "2025-11-04T12:30:00Z",
              }, null, 2)}
            />
          </div>
          <pre className="bg-muted p-4 rounded-md overflow-x-auto">
            <code className="text-xs font-mono">
              {JSON.stringify({
                invoiceId: "550e8400-e29b-41d4-a716-446655440000",
                amount: "0.001",
                currency: "BTC",
                status: "paid",
                paidAt: "2025-11-04T12:30:00Z",
              }, null, 2)}
            </code>
          </pre>
          <p className="text-xs text-muted-foreground">
            Set the ALTOSTRATUS_WEBHOOK_URL environment variable to configure where notifications are sent.
          </p>
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
              <h4 className="text-sm font-semibold mb-1">WEBHOOK_RETRY_ATTEMPTS</h4>
              <p className="text-xs text-muted-foreground">Number of webhook retry attempts (default: 3)</p>
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
          <p className="text-xs text-muted-foreground">
            You can use external cron services, systemd timers, or cloud schedulers to call these endpoints.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
