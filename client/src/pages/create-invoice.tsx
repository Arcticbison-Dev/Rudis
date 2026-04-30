import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertInvoiceSchema, type InsertInvoice } from "@shared/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation, useSearch } from "wouter";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Loader2, Info, RefreshCw, DollarSign } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

const currencies = [
  { value: "BTC",       label: "Bitcoin",   short: "BTC",  cgId: "bitcoin" },
  { value: "Lightning", label: "Lightning",  short: "BTC",  cgId: "bitcoin" },
  { value: "XMR",       label: "Monero",    short: "XMR",  cgId: "monero" },
] as const;

type Currency = (typeof currencies)[number]["value"];

interface PriceData {
  bitcoin?: { usd: number };
  monero?:  { usd: number };
}

function toCryptoAmount(usd: number, priceUsd: number, decimals: number): string {
  if (!usd || !priceUsd) return "";
  const crypto = usd / priceUsd;
  return crypto.toFixed(decimals);
}

export default function CreateInvoice() {
  const [, setLocation] = useLocation();
  const searchParams = useSearch();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>("BTC");
  const [usdAmount, setUsdAmount] = useState("");
  const [priceRefreshed, setPriceRefreshed] = useState(false);

  const form = useForm<InsertInvoice>({
    resolver: zodResolver(insertInvoiceSchema),
    defaultValues: {
      amount: "",
      currency: "BTC",
      description: "",
      paymentAddress: "",
      expiresAt: undefined,
    },
  });

  // Live price fetch from CoinGecko
  const cgId = currencies.find((c) => c.value === selectedCurrency)?.cgId ?? "bitcoin";
  const decimals = selectedCurrency === "XMR" ? 8 : 8;

  const { data: prices, isFetching: pricesFetching, refetch: refetchPrices } = useQuery<PriceData>({
    queryKey: ["coingecko-prices"],
    queryFn: async () => {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,monero&vs_currencies=usd"
      );
      if (!res.ok) throw new Error("Price fetch failed");
      return res.json();
    },
    staleTime: 60_000,       // prices stale after 1 min
    refetchInterval: 120_000, // auto-refresh every 2 min
    retry: 2,
  });

  const priceUsd: number | null =
    cgId === "bitcoin" ? (prices?.bitcoin?.usd ?? null) : (prices?.monero?.usd ?? null);

  // Derive crypto amount from USD whenever USD or price changes
  const derivedCrypto = usdAmount && priceUsd
    ? toCryptoAmount(parseFloat(usdAmount) || 0, priceUsd, decimals)
    : "";

  // Keep form amount field in sync with derived crypto
  useEffect(() => {
    if (derivedCrypto) {
      form.setValue("amount", derivedCrypto, { shouldValidate: true });
    }
  }, [derivedCrypto, form]);

  // Reset USD when currency changes
  useEffect(() => {
    // don't reset crypto amount if entered directly
  }, [selectedCurrency]);

  // Load from template query param
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    const templateData = params.get("template");
    if (templateData) {
      try {
        const data = JSON.parse(decodeURIComponent(templateData));
        const currency = (data.currency || "BTC") as Currency;
        setSelectedCurrency(currency);
        form.reset({
          amount: data.amount || "",
          currency,
          description: data.description || "",
          paymentAddress: data.paymentAddress || "",
          expiresAt: data.expiresAt || undefined,
        });
        if (data.amountUsd) setUsdAmount(data.amountUsd);
      } catch (error) {
        console.error("Failed to parse template data:", error);
      }
    }
  }, [searchParams, form]);

  const createInvoiceMutation = useMutation({
    mutationFn: async (data: InsertInvoice) => {
      const adminToken = sessionStorage.getItem("admin_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (adminToken) headers["Authorization"] = `Bearer ${adminToken}`;
      const response = await fetch("/api/invoices", {
        method: "POST",
        headers,
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status}: ${text}`);
      }
      return response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Invoice created!", description: "Your payment invoice is ready." });
      setLocation(`/invoice/${data.id}`);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to create invoice",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: InsertInvoice) => {
    createInvoiceMutation.mutate(data);
  };

  const handleRefreshPrice = async () => {
    await refetchPrices();
    setPriceRefreshed(true);
    setTimeout(() => setPriceRefreshed(false), 2000);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="flex items-center gap-4">
        <Link href="/">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight" data-testid="heading-create-invoice">
            Create Invoice
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            Generate a new crypto payment invoice
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Invoice Details</CardTitle>
          <CardDescription>
            Enter a USD amount and we'll calculate the crypto equivalent at the current rate.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

              {/* Currency selector */}
              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Currency</FormLabel>
                    <FormControl>
                      <div className="grid grid-cols-3 gap-3">
                        {currencies.map((currency) => (
                          <Button
                            key={currency.value}
                            type="button"
                            variant={selectedCurrency === currency.value ? "default" : "outline"}
                            className="justify-center"
                            onClick={() => {
                              setSelectedCurrency(currency.value);
                              field.onChange(currency.value);
                            }}
                            data-testid={`button-currency-${currency.value.toLowerCase()}`}
                          >
                            {currency.label}
                          </Button>
                        ))}
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* USD Amount + live conversion */}
              <div className="space-y-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Amount (USD)</label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={usdAmount}
                      onChange={(e) => setUsdAmount(e.target.value)}
                      className="pl-8 text-lg font-mono"
                      data-testid="input-usd-amount"
                    />
                  </div>
                </div>

                {/* Live price display + derived crypto amount */}
                <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground font-medium">LIVE RATE</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs gap-1"
                      onClick={handleRefreshPrice}
                      disabled={pricesFetching}
                    >
                      <RefreshCw className={`h-3 w-3 ${pricesFetching ? "animate-spin" : ""}`} />
                      {priceRefreshed ? "Updated" : "Refresh"}
                    </Button>
                  </div>

                  {priceUsd ? (
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm text-muted-foreground">
                        1 {currencies.find((c) => c.value === selectedCurrency)?.short} = ${priceUsd.toLocaleString()} USD
                      </span>
                      {derivedCrypto && usdAmount && (
                        <div className="text-right">
                          <span className="text-xs text-muted-foreground">You'll charge</span>
                          <div className="font-mono font-bold text-base">
                            {derivedCrypto}{" "}
                            <span className="text-sm font-normal text-muted-foreground">
                              {currencies.find((c) => c.value === selectedCurrency)?.short}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      {pricesFetching ? "Fetching live price..." : "Price unavailable — enter crypto amount directly below"}
                    </div>
                  )}
                </div>
              </div>

              {/* Crypto amount — direct entry fallback */}
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      Crypto Amount
                      {derivedCrypto && (
                        <Badge variant="secondary" className="text-xs font-normal">
                          auto-calculated
                        </Badge>
                      )}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="text"
                        placeholder="0.00000000"
                        className="font-mono"
                        onChange={(e) => {
                          field.onChange(e);
                          // If user types directly, clear USD field
                          if (e.target.value !== derivedCrypto) {
                            setUsdAmount("");
                          }
                        }}
                        data-testid="input-amount"
                      />
                    </FormControl>
                    <FormDescription>
                      {priceUsd
                        ? `Filled automatically from USD amount · or enter ${selectedCurrency} directly`
                        : `Amount in ${selectedCurrency} (up to 8 decimal places)`}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Payment address */}
              <FormField
                control={form.control}
                name="paymentAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment Address</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="text"
                        placeholder={
                          selectedCurrency === "BTC"
                            ? "bc1q..."
                            : selectedCurrency === "Lightning"
                            ? "lnbc..."
                            : "4..."
                        }
                        className="font-mono text-sm"
                        data-testid="input-payment-address"
                      />
                    </FormControl>
                    <FormDescription>
                      The {selectedCurrency} address where payment will be received
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Description */}
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="What is this payment for?"
                        className="resize-none min-h-24"
                        data-testid="input-description"
                      />
                    </FormControl>
                    <FormDescription>Describe the purpose of this invoice</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex gap-4 pt-4">
                <Link href="/" className="flex-1">
                  <Button type="button" variant="outline" className="w-full" data-testid="button-cancel">
                    Cancel
                  </Button>
                </Link>
                <Button
                  type="submit"
                  className="flex-1 gap-2"
                  disabled={createInvoiceMutation.isPending}
                  data-testid="button-submit"
                >
                  {createInvoiceMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Create Invoice
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Alert data-testid="alert-privacy-notice">
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs text-muted-foreground">
          <strong>Privacy &amp; Data Retention:</strong> Rudis is self-hosted and privacy-first.
          No personally identifiable information is stored. Paid invoices are automatically anonymized
          after 90 days and permanently purged after 365 days.
        </AlertDescription>
      </Alert>
    </div>
  );
}
