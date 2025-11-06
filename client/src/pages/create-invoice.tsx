import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertInvoiceSchema, type InsertInvoice } from "@shared/schema";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { ArrowLeft, Loader2, Info } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";

const currencies = [
  { value: "BTC", label: "Bitcoin (BTC)" },
  { value: "Lightning", label: "Lightning Network" },
  { value: "XMR", label: "Monero (XMR)" },
] as const;

export default function CreateInvoice() {
  const [, setLocation] = useLocation();
  const searchParams = useSearch();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedCurrency, setSelectedCurrency] = useState<"BTC" | "Lightning" | "XMR">("BTC");

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

  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    const templateData = params.get("template");
    if (templateData) {
      try {
        const data = JSON.parse(decodeURIComponent(templateData));
        const currency = (data.currency || "BTC") as "BTC" | "Lightning" | "XMR";
        setSelectedCurrency(currency);
        form.reset({
          amount: data.amount || "",
          currency: currency,
          description: data.description || "",
          paymentAddress: data.paymentAddress || "",
          expiresAt: data.expiresAt || undefined,
        });
      } catch (error) {
        console.error("Failed to parse template data:", error);
      }
    }
  }, [searchParams, form]);

  const createInvoiceMutation = useMutation({
    mutationFn: async (data: InsertInvoice) => {
      const response = await apiRequest("POST", "/api/invoices", data);
      return response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({
        title: "Invoice created!",
        description: "Your payment invoice has been created successfully.",
      });
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
            Enter the payment details for your crypto invoice
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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
                            className={`justify-center ${selectedCurrency === currency.value ? "" : "hover-elevate active-elevate-2"}`}
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
                    <FormDescription>
                      Select the cryptocurrency for payment
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="text"
                        placeholder="0.00000000"
                        className="text-2xl font-mono"
                        data-testid="input-amount"
                      />
                    </FormControl>
                    <FormDescription>
                      Amount in {selectedCurrency} (up to 8 decimal places)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

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
                    <FormDescription>
                      Describe the purpose of this invoice
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex gap-4 pt-4">
                <Link href="/" className="flex-1">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    data-testid="button-cancel"
                  >
                    Cancel
                  </Button>
                </Link>
                <Button
                  type="submit"
                  className="flex-1 gap-2"
                  disabled={createInvoiceMutation.isPending}
                  data-testid="button-submit"
                >
                  {createInvoiceMutation.isPending && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
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
          <strong>Privacy & Data Retention:</strong> This system is privacy-first and self-hosted. 
          No personally identifiable information is stored. Invoices include QR codes for easy payment. 
          Paid invoices are automatically anonymized after 90 days and permanently deleted after 365 days. 
          See our{" "}
          <a 
            href="/docs/CRYPTO_PAYMENT_POLICY.md" 
            target="_blank" 
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            payment policy
          </a>{" "}
          for details.
        </AlertDescription>
      </Alert>
    </div>
  );
}
