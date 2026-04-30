import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { type Invoice, type WebhookLog, type PaymentTransaction } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Calendar, Clock, CheckCircle2, ExternalLink, AlertCircle, Hash } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { CopyButton } from "@/components/copy-button";
import { Skeleton } from "@/components/ui/skeleton";
import { QRCodeSVG } from "qrcode.react";
import { format, formatDistanceToNow } from "date-fns";

function getExplorerUrl(currency: string, transactionId: string): string {
  switch (currency) {
    case "BTC":
      return `https://mempool.space/tx/${transactionId}`;
    case "Lightning":
      return "";
    case "XMR":
      return `https://xmrchain.net/tx/${transactionId}`;
    default:
      return "";
  }
}

export default function InvoiceDetail() {
  const { id } = useParams();
  
  const { data: invoice, isLoading } = useQuery<Invoice>({
    queryKey: ["/api/invoices", id],
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.status === "pending" ? 5000 : false;
    },
  });

  const { data: webhookLogs } = useQuery<WebhookLog[]>({
    queryKey: ["/api/invoices", id, "webhook-logs"],
    enabled: !!id,
  });

  const { data: transactions } = useQuery<PaymentTransaction[]>({
    queryKey: ["/api/invoices", id, "transactions"],
    enabled: !!id && invoice?.status === "paid",
  });

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <div className="space-y-2">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="max-w-4xl mx-auto">
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <h3 className="text-lg font-semibold mb-2">Invoice not found</h3>
            <p className="text-sm text-muted-foreground mb-6">
              The invoice you're looking for doesn't exist.
            </p>
            <Link href="/">
              <Button>Return to Dashboard</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-center gap-4 flex-wrap">
        <Link href="/">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight" data-testid="heading-invoice-detail">
              Invoice
            </h1>
            <StatusBadge status={invoice.status} />
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            <code className="font-mono" data-testid="text-invoice-id">{invoice.id}</code>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* QR Code Section */}
        <Card>
          <CardHeader>
            <CardTitle>Payment QR Code</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center space-y-6">
            <div className="bg-white p-6 rounded-lg border" data-testid="qr-code-container">
              <QRCodeSVG
                value={invoice.paymentAddress}
                size={256}
                level="H"
                includeMargin={false}
              />
            </div>
            <p className="text-sm text-muted-foreground text-center">
              Scan this QR code with your {invoice.currency} wallet to make payment
            </p>
            <div className="w-full">
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                Payment Address
              </label>
              <div className="flex items-center gap-2 bg-muted rounded-md px-3 py-2">
                <code className="text-xs font-mono break-all flex-1" data-testid="text-payment-address">
                  {invoice.paymentAddress}
                </code>
                <CopyButton value={invoice.paymentAddress} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Payment Details Section */}
        <Card>
          <CardHeader>
            <CardTitle>Payment Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground block mb-1">
                  Amount
                </label>
                <div className="text-3xl font-bold font-mono" data-testid="text-invoice-amount">
                  {invoice.amount}
                </div>
                <div className="text-sm font-medium text-muted-foreground mt-1" data-testid="text-invoice-currency">
                  {invoice.currency}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-muted-foreground block mb-1">
                  Description
                </label>
                <p className="text-base" data-testid="text-invoice-description">
                  {invoice.description}
                </p>
              </div>

              <div className="pt-4 border-t space-y-3">
                <div className="flex items-center gap-3">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1">
                    <label className="text-xs font-medium text-muted-foreground block">
                      Created
                    </label>
                    <p className="text-sm" data-testid="text-created-date">
                      {format(new Date(invoice.createdAt), "PPpp")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(invoice.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                </div>

                {invoice.paidAt && (
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    <div className="flex-1">
                      <label className="text-xs font-medium text-muted-foreground block">
                        Paid
                      </label>
                      <p className="text-sm" data-testid="text-paid-date">
                        {format(new Date(invoice.paidAt), "PPpp")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(invoice.paidAt), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                )}

                {invoice.expiresAt && (
                  <div className="flex items-center gap-3">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <div className="flex-1">
                      <label className="text-xs font-medium text-muted-foreground block">
                        Expires
                      </label>
                      <p className="text-sm" data-testid="text-expires-date">
                        {format(new Date(invoice.expiresAt), "PPpp")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(invoice.expiresAt), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {invoice.status === "pending" && (
                <div className="pt-4">
                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md p-4">
                    <p className="text-sm text-amber-900 dark:text-amber-100">
                      Awaiting payment confirmation. This page will update automatically when payment is received.
                    </p>
                  </div>
                </div>
              )}

              {invoice.status === "paid" && (
                <div className="pt-4">
                  <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-md p-4">
                    <p className="text-sm text-emerald-900 dark:text-emerald-100">
                      Payment confirmed! This invoice has been successfully paid.
                    </p>
                  </div>
                </div>
              )}

              {invoice.status === "expired" && (
                <div className="pt-4">
                  <div className="bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-700 rounded-md p-4">
                    <p className="text-sm text-slate-900 dark:text-slate-100">
                      This invoice has expired and can no longer be paid.
                    </p>
                  </div>
                </div>
              )}

              {invoice.status === "pending" && invoice.expiresAt && new Date(invoice.expiresAt) < new Date(Date.now() + (parseInt(import.meta.env.VITE_EXPIRING_SOON_HOURS || "1") * 3600000)) && new Date(invoice.expiresAt) > new Date() && (
                <div className="pt-4">
                  <div className="bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-md p-4 flex items-start gap-2">
                    <Clock className="h-4 w-4 text-orange-600 dark:text-orange-400 shrink-0 mt-0.5" />
                    <p className="text-sm text-orange-900 dark:text-orange-100">
                      This invoice is expiring soon. Please complete payment before expiration.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Timeline Section */}
      <Card>
        <CardHeader>
          <CardTitle>Activity Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 border-2 border-primary shrink-0">
                <div className="w-2 h-2 rounded-full bg-primary" />
              </div>
              <div className="flex-1 pb-4 border-b">
                <p className="font-medium">Invoice created</p>
                <p className="text-sm text-muted-foreground">
                  {format(new Date(invoice.createdAt), "PPpp")}
                </p>
              </div>
            </div>

            {invoice.paidAt && (
              <div className="flex items-start gap-4">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-950 border-2 border-emerald-600 dark:border-emerald-400 shrink-0">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="flex-1 pb-4">
                  <p className="font-medium">Payment confirmed</p>
                  <p className="text-sm text-muted-foreground">
                    {format(new Date(invoice.paidAt), "PPpp")}
                  </p>
                </div>
              </div>
            )}

            {!invoice.paidAt && invoice.status === "pending" && (
              <div className="flex items-start gap-4">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-950 border-2 border-amber-600 dark:border-amber-400 shrink-0">
                  <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400 animate-pulse" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">Awaiting payment</p>
                  <p className="text-sm text-muted-foreground">
                    Monitoring blockchain for confirmation
                  </p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Payment Transactions Section */}
      {transactions && transactions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Payment Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="border rounded-md p-4 space-y-3"
                  data-testid={`transaction-${tx.id}`}
                >
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge className="bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800">
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          Confirmed
                        </Badge>
                        <Badge variant="outline" className="font-mono text-xs">
                          {tx.confirmations} confirmations
                        </Badge>
                        {tx.blockHeight && (
                          <Badge variant="outline" className="font-mono text-xs">
                            Block {tx.blockHeight}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <Hash className="w-3 h-3 text-muted-foreground shrink-0" />
                        <code className="text-xs font-mono text-muted-foreground break-all" data-testid={`text-tx-hash-${tx.id}`}>
                          {tx.transactionId}
                        </code>
                        <CopyButton value={tx.transactionId} />
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <div className="text-xs text-muted-foreground text-right">
                        <div>{format(new Date(tx.confirmedAt), "PPp")}</div>
                        <div>{formatDistanceToNow(new Date(tx.confirmedAt), { addSuffix: true })}</div>
                      </div>
                      {getExplorerUrl(invoice.currency, tx.transactionId) && (
                        <Button
                          variant="outline"
                          size="sm"
                          asChild
                          data-testid={`button-explorer-${tx.id}`}
                        >
                          <a
                            href={getExplorerUrl(invoice.currency, tx.transactionId)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2"
                          >
                            <ExternalLink className="w-3 h-3" />
                            View on Explorer
                          </a>
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Webhook Logs Section */}
      {webhookLogs && webhookLogs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Webhook Delivery Logs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {webhookLogs.map((log) => (
                <div
                  key={log.id}
                  className="border rounded-md p-4 space-y-3"
                  data-testid={`webhook-log-${log.id}`}
                >
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        {log.status === "success" ? (
                          <Badge className="bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800">
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Success
                          </Badge>
                        ) : log.status === "pending" ? (
                          <Badge className="bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800">
                            <Clock className="w-3 h-3 mr-1" />
                            Pending
                          </Badge>
                        ) : (
                          <Badge className="bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800">
                            <AlertCircle className="w-3 h-3 mr-1" />
                            Failed
                          </Badge>
                        )}
                        <Badge variant="outline" className="font-mono text-xs">
                          Attempt {log.attempt}
                        </Badge>
                        {log.statusCode && (
                          <Badge variant="outline" className="font-mono text-xs">
                            HTTP {log.statusCode}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0" />
                        <code className="text-xs font-mono text-muted-foreground break-all">
                          {log.url}
                        </code>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground text-right">
                      <div>Queued: {format(new Date(log.createdAt), "PPp")}</div>
                      {log.lastAttemptAt && (
                        <div>Last attempt: {formatDistanceToNow(new Date(log.lastAttemptAt), { addSuffix: true })}</div>
                      )}
                      {log.retryAfter && log.status === "pending" && (
                        <div className="text-amber-600 dark:text-amber-400">
                          Next retry: {formatDistanceToNow(new Date(log.retryAfter), { addSuffix: true })}
                        </div>
                      )}
                    </div>
                  </div>

                  {log.errorMessage && (
                    <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md p-3">
                      <p className="text-xs font-medium text-red-900 dark:text-red-100 mb-1">
                        Error Message
                      </p>
                      <code className="text-xs font-mono text-red-800 dark:text-red-200 break-all">
                        {log.errorMessage}
                      </code>
                    </div>
                  )}

                  {log.status === "pending" && (
                    <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md p-3">
                      <p className="text-xs text-amber-900 dark:text-amber-100">
                        Delivery pending - will retry automatically
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
