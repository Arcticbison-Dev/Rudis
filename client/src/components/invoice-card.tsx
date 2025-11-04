import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { type Invoice } from "@shared/schema";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";

interface InvoiceCardProps {
  invoice: Invoice;
}

const statusColors = {
  pending: "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800",
  paid: "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
  expired: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700",
};

export function InvoiceCard({ invoice }: InvoiceCardProps) {
  return (
    <Link href={`/invoice/${invoice.id}`}>
      <Card
        className="hover-elevate active-elevate-2 cursor-pointer transition-all duration-200"
        data-testid={`card-invoice-${invoice.id}`}
      >
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <code className="text-xs font-mono text-muted-foreground" data-testid={`text-invoice-id-${invoice.id}`}>
            {invoice.id.slice(0, 8)}...
          </code>
          <Badge
            className={`${statusColors[invoice.status as keyof typeof statusColors] || statusColors.pending} rounded-full px-3 py-1 text-xs font-medium uppercase tracking-wide border`}
            data-testid={`badge-status-${invoice.id}`}
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-current mr-2" />
            {invoice.status}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="text-3xl font-bold font-mono tracking-tight" data-testid={`text-amount-${invoice.id}`}>
              {invoice.amount}
            </div>
            <div className="text-sm font-medium text-muted-foreground mt-1" data-testid={`text-currency-${invoice.id}`}>
              {invoice.currency}
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-sm line-clamp-2" data-testid={`text-description-${invoice.id}`}>
              {invoice.description}
            </p>
            <p className="text-xs text-muted-foreground" data-testid={`text-created-${invoice.id}`}>
              Created {formatDistanceToNow(new Date(invoice.createdAt), { addSuffix: true })}
            </p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
