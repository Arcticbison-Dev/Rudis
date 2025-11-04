import { useQuery } from "@tanstack/react-query";
import { type Invoice } from "@shared/schema";
import { InvoiceCard } from "@/components/invoice-card";
import { StatsCard } from "@/components/stats-card";
import { Button } from "@/components/ui/button";
import { FileText, CheckCircle, Clock, XCircle, Plus } from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export default function Dashboard() {
  const { data: invoices, isLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices"],
  });

  const stats = {
    total: invoices?.length || 0,
    pending: invoices?.filter((inv) => inv.status === "pending").length || 0,
    paid: invoices?.filter((inv) => inv.status === "paid").length || 0,
    expired: invoices?.filter((inv) => inv.status === "expired").length || 0,
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight" data-testid="heading-dashboard">
            Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            Manage your crypto payment invoices
          </p>
        </div>
        <Link href="/create">
          <Button size="lg" className="gap-2" data-testid="button-create-invoice">
            <Plus className="h-4 w-4" />
            Create Invoice
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <StatsCard
          title="Total Invoices"
          value={stats.total}
          icon={FileText}
          description="All time"
        />
        <StatsCard
          title="Pending"
          value={stats.pending}
          icon={Clock}
          description="Awaiting payment"
        />
        <StatsCard
          title="Paid"
          value={stats.paid}
          icon={CheckCircle}
          description="Successfully paid"
        />
        <StatsCard
          title="Expired"
          value={stats.expired}
          icon={XCircle}
          description="Timed out"
        />
      </div>

      <div>
        <h2 className="text-xl md:text-2xl font-semibold mb-6">Recent Invoices</h2>
        
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <Card key={i}>
                <CardContent className="p-6 space-y-4">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-8 w-32" />
                  <Skeleton className="h-12 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : invoices && invoices.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {invoices.map((invoice) => (
              <InvoiceCard key={invoice.id} invoice={invoice} />
            ))}
          </div>
        ) : (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <FileText className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No invoices yet</h3>
              <p className="text-sm text-muted-foreground mb-6 max-w-md">
                Create your first crypto payment invoice to get started. Supports Bitcoin, Lightning Network, and Monero.
              </p>
              <Link href="/create">
                <Button className="gap-2" data-testid="button-create-first-invoice">
                  <Plus className="h-4 w-4" />
                  Create Your First Invoice
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
