import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { type Invoice } from "@shared/schema";
import { InvoiceCard } from "@/components/invoice-card";
import { StatsCard } from "@/components/stats-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileText, CheckCircle, Clock, XCircle, Plus, TrendingUp, Search, Download } from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface StatsData {
  counts: { total: number; pending: number; paid: number; expired: number };
  volume: Record<string, { atomic: string; formatted: string }>;
}

const RAIL_LABELS: Record<string, { label: string; unit: string; decimals: number }> = {
  BTC:       { label: "Bitcoin",  unit: "BTC",  decimals: 8  },
  Lightning: { label: "Lightning", unit: "BTC", decimals: 8  },
  XMR:       { label: "Monero",   unit: "XMR",  decimals: 6  },
};

const PAGE_SIZE = 20;

type StatusFilter = "all" | "pending" | "paid" | "expired";

function exportCSV(rows: Invoice[]) {
  const headers = ["ID", "Status", "Currency", "Amount", "Description", "Created", "Paid", "Expires"];
  const escape = (v: string | null | undefined) => {
    if (v == null) return "";
    const s = String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const lines = [
    headers.join(","),
    ...rows.map((inv) =>
      [
        inv.id,
        inv.status,
        inv.currency,
        inv.amount,
        inv.description,
        inv.createdAt  ? new Date(inv.createdAt).toISOString()  : "",
        inv.paidAt     ? new Date(inv.paidAt).toISOString()     : "",
        inv.expiresAt  ? new Date(inv.expiresAt).toISOString()  : "",
      ]
        .map(escape)
        .join(",")
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rudis-invoices-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Dashboard() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data: invoices, isLoading: invoicesLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices"],
  });

  const { data: statsData, isLoading: statsLoading } = useQuery<StatsData>({
    queryKey: ["/api/stats"],
    refetchInterval: 30_000,
  });

  // Filter + search
  const filtered = (invoices ?? []).filter((inv) => {
    if (statusFilter !== "all" && inv.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        inv.id.toLowerCase().includes(q) ||
        (inv.description?.toLowerCase().includes(q)) ||
        inv.currency.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Sort newest first
  const sorted = [...filtered].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const counts = statsData?.counts ?? {
    total: invoices?.length ?? 0,
    pending: invoices?.filter((i) => i.status === "pending").length ?? 0,
    paid: invoices?.filter((i) => i.status === "paid").length ?? 0,
    expired: invoices?.filter((i) => i.status === "expired").length ?? 0,
  };

  const handleStatusChange = (v: string) => {
    setStatusFilter(v as StatusFilter);
    setPage(1);
  };

  const handleSearch = (v: string) => {
    setSearch(v);
    setPage(1);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight" data-testid="heading-dashboard">
            Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            Crypto payment invoice management
          </p>
        </div>
        <Link href="/create">
          <Button size="lg" className="gap-2" data-testid="button-create-invoice">
            <Plus className="h-4 w-4" />
            New Invoice
          </Button>
        </Link>
      </div>

      {/* Status counts */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatsCard
          title="Total Invoices"
          value={counts.total}
          icon={FileText}
          description="All time"
        />
        <StatsCard
          title="Pending"
          value={counts.pending}
          icon={Clock}
          description="Awaiting payment"
        />
        <StatsCard
          title="Paid"
          value={counts.paid}
          icon={CheckCircle}
          description="Successfully settled"
        />
        <StatsCard
          title="Expired"
          value={counts.expired}
          icon={XCircle}
          description="Timed out"
        />
      </div>

      {/* Revenue / volume panel */}
      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-orange-500" />
          Volume Received
        </h2>
        {statsLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
          </div>
        ) : statsData && Object.keys(statsData.volume).length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(statsData.volume).map(([rail, vol]) => {
              const meta = RAIL_LABELS[rail] ?? { label: rail, unit: rail, decimals: 8 };
              const displayAmount = parseFloat(vol.formatted).toFixed(meta.decimals);
              return (
                <Card key={rail} className="bg-muted/30 border-border/60">
                  <CardHeader className="pb-1 pt-4 px-4">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {meta.label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pb-4 px-4">
                    <div className="font-mono font-bold text-xl tabular-nums">
                      {displayAmount}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{meta.unit} received</div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card className="border-dashed border-border/40">
            <CardContent className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              No payments received yet
            </CardContent>
          </Card>
        )}
      </div>

      {/* Invoice list with filter + search + pagination */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h2 className="text-xl font-semibold">Invoices</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search by ID or description..."
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                className="pl-8 w-56 h-8 text-sm"
              />
            </div>
            <Select value={statusFilter} onValueChange={handleStatusChange}>
              <SelectTrigger className="w-32 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
              </SelectContent>
            </Select>
            {filtered.length !== (invoices?.length ?? 0) && (
              <Badge variant="secondary" className="text-xs">
                {filtered.length} of {invoices?.length ?? 0}
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-sm"
              onClick={() => exportCSV(sorted)}
              disabled={sorted.length === 0}
              title="Export filtered invoices as CSV"
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
          </div>
        </div>

        {invoicesLoading ? (
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
        ) : paginated.length > 0 ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {paginated.map((invoice) => (
                <InvoiceCard key={invoice.id} invoice={invoice} />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <p className="text-sm text-muted-foreground">
                  Page {page} of {totalPages} · {filtered.length} invoices
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : invoices && invoices.length > 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 px-6 text-center">
              <Search className="h-10 w-10 text-muted-foreground mb-3" />
              <h3 className="text-base font-semibold mb-1">No invoices match your filter</h3>
              <p className="text-sm text-muted-foreground">
                Try adjusting the status filter or search query.
              </p>
            </CardContent>
          </Card>
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
