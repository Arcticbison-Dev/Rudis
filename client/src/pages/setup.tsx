import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { CopyButton } from "@/components/copy-button";
import {
  Zap,
  Bitcoin,
  Webhook,
  Shield,
  ArrowRight,
  CheckCircle2,
  Terminal,
  BookOpen,
  ExternalLink,
  Server,
  Key,
} from "lucide-react";

interface Step {
  id: string;
  title: string;
  description: string;
  icon: React.FC<{ className?: string }>;
}

const SETUP_STEPS: Step[] = [
  {
    id: "deploy",
    title: "Deploy Rudis",
    description: "Clone the repo and deploy to your server, VPS, or Replit. Rudis is self-hosted — your keys, your data.",
    icon: Server,
  },
  {
    id: "configure",
    title: "Configure environment",
    description: "Set the required environment variables to connect your payment rails and webhook receiver.",
    icon: Key,
  },
  {
    id: "webhook",
    title: "Set up your webhook endpoint",
    description: "Create a POST endpoint in your app to receive payment notifications from Rudis.",
    icon: Webhook,
  },
  {
    id: "invoice",
    title: "Create your first invoice",
    description: "Use the dashboard or API to generate a crypto invoice and test the full payment flow.",
    icon: Bitcoin,
  },
];

const ENV_VARS = [
  {
    name: "DATABASE_URL",
    required: true,
    description: "PostgreSQL connection string (Neon, Supabase, or self-hosted)",
    example: "postgresql://user:pass@host:5432/db",
  },
  {
    name: "RUDIS_WEBHOOK_URL",
    required: true,
    description: "Your app's webhook endpoint — Rudis POSTs payment confirmations here",
    example: "https://yourapp.com/webhooks/payment",
  },
  {
    name: "RUDIS_WEBHOOK_SECRET",
    required: true,
    description: "Secret for HMAC-SHA256 signing of outbound webhooks",
    example: "a-long-random-secret-string",
  },
  {
    name: "ADMIN_API_TOKEN",
    required: true,
    description: "Token for accessing the admin panel and fee management",
    example: "your-admin-token",
  },
  {
    name: "ENABLE_LN",
    required: false,
    description: "Enable Lightning Network payments (requires LN_SERVICE_URL)",
    example: "true",
  },
  {
    name: "ENABLE_BTC",
    required: false,
    description: "Enable on-chain Bitcoin payments (requires BTC_SERVICE_URL)",
    example: "true",
  },
  {
    name: "ENABLE_XMR",
    required: false,
    description: "Enable Monero payments (requires XMR_SERVICE_URL)",
    example: "true",
  },
  {
    name: "LN_SERVICE_URL",
    required: false,
    description: "URL of the Lightning rail adapter service",
    example: "http://localhost:5001",
  },
  {
    name: "BTC_SERVICE_URL",
    required: false,
    description: "URL of the Bitcoin rail adapter service",
    example: "http://localhost:5002",
  },
  {
    name: "XMR_SERVICE_URL",
    required: false,
    description: "URL of the Monero rail adapter service",
    example: "http://localhost:5003",
  },
];

export default function Setup() {
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());

  const toggleStep = (id: string) => {
    setCompletedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-12">
      {/* Hero */}
      <div className="text-center space-y-4 pt-4">
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-xl bg-orange-500 flex items-center justify-center shadow-lg">
            <Zap className="h-6 w-6 text-white" strokeWidth={2.5} />
          </div>
          <h1 className="text-4xl font-bold tracking-tight">Rudis</h1>
        </div>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Self-hosted crypto payment infrastructure. Accept Bitcoin, Lightning, and Monero with HMAC-signed webhook notifications.
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Badge variant="outline" className="gap-1.5">
            <Bitcoin className="h-3 w-3" /> Bitcoin
          </Badge>
          <Badge variant="outline" className="gap-1.5">
            <Zap className="h-3 w-3 text-orange-400" /> Lightning
          </Badge>
          <Badge variant="outline" className="gap-1.5">
            <Shield className="h-3 w-3 text-teal-400" /> Monero
          </Badge>
          <Badge variant="secondary" className="gap-1.5">
            Self-hosted
          </Badge>
          <Badge variant="secondary" className="gap-1.5">
            Privacy-first
          </Badge>
        </div>
        <div className="flex items-center justify-center gap-3 pt-2">
          <Link href="/">
            <Button size="lg" className="gap-2">
              Go to Dashboard
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Link href="/api-docs">
            <Button variant="outline" size="lg" className="gap-2">
              <BookOpen className="h-4 w-4" />
              API Docs
            </Button>
          </Link>
        </div>
      </div>

      {/* Setup checklist */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold">Getting Started</h2>
        <div className="grid gap-3">
          {SETUP_STEPS.map((step, i) => {
            const Icon = step.icon;
            const done = completedSteps.has(step.id);
            return (
              <Card
                key={step.id}
                className={`cursor-pointer transition-colors ${done ? "border-emerald-600/50 dark:border-emerald-500/40 bg-emerald-950/10" : "hover:bg-muted/30"}`}
                onClick={() => toggleStep(step.id)}
              >
                <CardContent className="flex items-start gap-4 py-4 px-5">
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-0.5 transition-colors ${
                    done ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground"
                  }`}>
                    {done ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <span className="text-sm font-bold">{i + 1}</span>
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <h3 className={`font-semibold ${done ? "line-through text-muted-foreground" : ""}`}>
                        {step.title}
                      </h3>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{step.description}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">Click each step to mark it complete.</p>
      </div>

      {/* Environment variables reference */}
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold">Environment Variables</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Set these in your <code className="text-xs bg-muted px-1.5 py-0.5 rounded">.env</code> file or deployment platform.
          </p>
        </div>
        <div className="space-y-2">
          {ENV_VARS.map((v) => (
            <Card key={v.name} className="border-border/60">
              <CardContent className="py-3 px-4">
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <code className="text-sm font-mono font-semibold">{v.name}</code>
                      {v.required ? (
                        <Badge variant="destructive" className="text-xs h-4">required</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs h-4">optional</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{v.description}</p>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground bg-muted/50 px-2 py-1 rounded shrink-0">
                    <span className="truncate max-w-48">{v.example}</span>
                    <CopyButton value={`${v.name}="${v.example}"`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* What happens after payment */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook className="h-4 w-4 text-orange-500" />
            Payment Flow
          </CardTitle>
          <CardDescription>What happens when a customer pays an invoice</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {[
              "Your app calls POST /api/invoices to create an invoice with a payment address",
              "Customer scans the QR code or copies the address and sends crypto",
              "The rail adapter (BTC/LN/XMR) detects the transaction and calls POST /api/webhooks/payment-confirmed",
              "Rudis marks the invoice as paid and fires a signed POST to your RUDIS_WEBHOOK_URL",
              "Your app receives the webhook, verifies the HMAC signature, and activates the order/subscription",
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-orange-500/20 text-orange-400 text-xs flex items-center justify-center font-bold mt-0.5">
                  {i + 1}
                </span>
                <span className="text-sm text-muted-foreground">{step}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {/* Quick links */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Link href="/create">
          <Card className="cursor-pointer hover:bg-muted/30 transition-colors h-full">
            <CardContent className="flex flex-col items-center text-center py-6 gap-2">
              <Bitcoin className="h-6 w-6 text-orange-400" />
              <div className="font-semibold text-sm">Create Invoice</div>
              <div className="text-xs text-muted-foreground">Generate your first payment invoice</div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/api-docs">
          <Card className="cursor-pointer hover:bg-muted/30 transition-colors h-full">
            <CardContent className="flex flex-col items-center text-center py-6 gap-2">
              <Terminal className="h-6 w-6 text-blue-400" />
              <div className="font-semibold text-sm">API Reference</div>
              <div className="text-xs text-muted-foreground">Full endpoint docs with code examples</div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin">
          <Card className="cursor-pointer hover:bg-muted/30 transition-colors h-full">
            <CardContent className="flex flex-col items-center text-center py-6 gap-2">
              <Shield className="h-6 w-6 text-purple-400" />
              <div className="font-semibold text-sm">Admin Panel</div>
              <div className="text-xs text-muted-foreground">Fee policies and settlement management</div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
