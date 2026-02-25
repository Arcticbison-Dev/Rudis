import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Shield, Plus, Pencil, Trash2, LogOut, Lock, BarChart3, DollarSign, Wallet, CheckCircle, AlertTriangle } from "lucide-react";
import type { FeePolicy, FeeSettlement } from "@shared/schema";

function adminFetch(url: string, token: string, options: RequestInit = {}) {
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
}

interface FeeReportData {
  from: string;
  to: string;
  currencies: Array<{
    currency: string;
    totalInvoices: number;
    totalFeeAtomic: string;
    avgFeePercent: string;
  }>;
  totalInvoicesWithFees: number;
}

function AdminAuth({ onAuthenticate }: { onAuthenticate: (token: string) => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;
    setChecking(true);
    setError("");
    try {
      const res = await adminFetch("/admin/fee-policies", token.trim());
      if (res.status === 401) {
        setError("Invalid admin token");
      } else if (res.ok) {
        sessionStorage.setItem("admin_token", token.trim());
        onAuthenticate(token.trim());
      } else {
        setError("Server error. Please try again.");
      }
    } catch {
      setError("Connection failed. Is the server running?");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center mb-2">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>Admin Access</CardTitle>
          <CardDescription>Enter your admin API token to access fee policy management</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="admin-token">Admin API Token</Label>
              <Input
                id="admin-token"
                type="password"
                placeholder="Enter ADMIN_API_TOKEN"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                data-testid="input-admin-token"
                autoComplete="off"
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <Button type="submit" className="w-full" disabled={checking || !token.trim()} data-testid="button-admin-login">
              {checking ? "Verifying..." : "Authenticate"}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Token is stored in session only and never persisted to disk
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function PolicyForm({
  open,
  onOpenChange,
  token,
  editingPolicy,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  editingPolicy: FeePolicy | null;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const isEditing = !!editingPolicy;

  const [name, setName] = useState(editingPolicy?.name || "");
  const [feePercent, setFeePercent] = useState(editingPolicy?.feePercent || "1.0000");
  const [fixedFeeAtomic, setFixedFeeAtomic] = useState(editingPolicy?.fixedFeeAtomic || "0");
  const [minFeeAtomic, setMinFeeAtomic] = useState(editingPolicy?.minFeeAtomic || "0");
  const [maxFeeAtomic, setMaxFeeAtomic] = useState(editingPolicy?.maxFeeAtomic || "");
  const [currency, setCurrency] = useState(editingPolicy?.currency || "BTC");
  const [merchantId, setMerchantId] = useState(editingPolicy?.merchantId || "");
  const [active, setActive] = useState(editingPolicy?.active ?? true);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body: Record<string, any> = {
        name,
        feePercent,
        fixedFeeAtomic,
        minFeeAtomic,
        currency,
        active,
      };
      if (maxFeeAtomic) body.maxFeeAtomic = maxFeeAtomic;
      else body.maxFeeAtomic = null;
      if (merchantId) body.merchantId = merchantId;
      else body.merchantId = null;

      const url = isEditing ? `/admin/fee-policies/${editingPolicy.id}` : "/admin/fee-policies";
      const method = isEditing ? "PATCH" : "POST";

      const res = await adminFetch(url, token, {
        method,
        body: JSON.stringify(body),
      });

      if (res.ok) {
        toast({
          title: isEditing ? "Policy updated" : "Policy created",
          description: `Fee policy "${name}" has been ${isEditing ? "updated" : "created"}.`,
        });
        onSuccess();
        onOpenChange(false);
      } else {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        toast({ title: "Error", description: err.error || "Failed to save policy", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to save policy", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Fee Policy" : "Create Fee Policy"}</DialogTitle>
          <DialogDescription>
            {isEditing ? "Update the fee policy configuration" : "Configure a new fee policy for invoice creation"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="policy-name">Policy Name</Label>
            <Input id="policy-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Standard Fee" required data-testid="input-policy-name" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="fee-percent">Fee Percent</Label>
              <Input id="fee-percent" value={feePercent} onChange={(e) => setFeePercent(e.target.value)} placeholder="1.0000" data-testid="input-fee-percent" />
              <p className="text-xs text-muted-foreground">e.g. 1.0000 = 1%</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fixed-fee">Fixed Fee (atomic)</Label>
              <Input id="fixed-fee" value={fixedFeeAtomic} onChange={(e) => setFixedFeeAtomic(e.target.value)} placeholder="0" data-testid="input-fixed-fee" />
              <p className="text-xs text-muted-foreground">In satoshis or piconero</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="min-fee">Min Fee (atomic)</Label>
              <Input id="min-fee" value={minFeeAtomic} onChange={(e) => setMinFeeAtomic(e.target.value)} placeholder="0" data-testid="input-min-fee" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="max-fee">Max Fee (atomic)</Label>
              <Input id="max-fee" value={maxFeeAtomic} onChange={(e) => setMaxFeeAtomic(e.target.value)} placeholder="No cap" data-testid="input-max-fee" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger data-testid="select-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BTC">Bitcoin (BTC)</SelectItem>
                  <SelectItem value="Lightning">Lightning</SelectItem>
                  <SelectItem value="XMR">Monero (XMR)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="merchant-id">Merchant ID (optional)</Label>
              <Input id="merchant-id" value={merchantId} onChange={(e) => setMerchantId(e.target.value)} placeholder="Default (all)" data-testid="input-merchant-id" />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Label htmlFor="policy-active">Active</Label>
            <Button
              type="button"
              variant={active ? "default" : "outline"}
              size="sm"
              onClick={() => setActive(!active)}
              data-testid="button-toggle-active"
            >
              {active ? "Active" : "Inactive"}
            </Button>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-policy">Cancel</Button>
            <Button type="submit" disabled={saving || !name.trim()} data-testid="button-save-policy">
              {saving ? "Saving..." : isEditing ? "Update Policy" : "Create Policy"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AdminDashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<FeePolicy | null>(null);
  const [deletingPolicy, setDeletingPolicy] = useState<FeePolicy | null>(null);

  const { data: policies, isLoading: policiesLoading } = useQuery<FeePolicy[]>({
    queryKey: ["/admin/fee-policies"],
    queryFn: async () => {
      const res = await adminFetch("/admin/fee-policies", token);
      if (!res.ok) throw new Error("Failed to fetch policies");
      return res.json();
    },
  });

  const { data: feeReport, isLoading: reportLoading } = useQuery<FeeReportData>({
    queryKey: ["/admin/fee-report"],
    queryFn: async () => {
      const res = await adminFetch("/admin/fee-report", token);
      if (!res.ok) throw new Error("Failed to fetch report");
      return res.json();
    },
  });

  const { data: settlements, isLoading: settlementsLoading } = useQuery<FeeSettlement[]>({
    queryKey: ["/admin/fee-settlements"],
    queryFn: async () => {
      const res = await adminFetch("/admin/fee-settlements", token);
      if (!res.ok) throw new Error("Failed to fetch settlements");
      return res.json();
    },
  });

  const { data: feeStatus } = useQuery<{ feeCollectionEnabled: boolean; systemInGoodStanding: boolean; invoiceCreationBlocked: boolean }>({
    queryKey: ["/api/fee-status"],
    queryFn: async () => {
      const res = await fetch("/api/fee-status");
      return res.json();
    },
  });

  const handleCreateNew = () => {
    setEditingPolicy(null);
    setIsFormOpen(true);
  };

  const handleEdit = (policy: FeePolicy) => {
    setEditingPolicy(policy);
    setIsFormOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingPolicy) return;
    try {
      const res = await adminFetch(`/admin/fee-policies/${deletingPolicy.id}`, token, { method: "DELETE" });
      if (res.ok) {
        toast({ title: "Policy deleted", description: `"${deletingPolicy.name}" has been removed.` });
        queryClient.invalidateQueries({ queryKey: ["/admin/fee-policies"] });
        queryClient.invalidateQueries({ queryKey: ["/admin/fee-report"] });
      } else {
        toast({ title: "Error", description: "Failed to delete policy", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to delete policy", variant: "destructive" });
    }
    setDeletingPolicy(null);
  };

  const handleFormSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ["/admin/fee-policies"] });
    queryClient.invalidateQueries({ queryKey: ["/admin/fee-report"] });
  };

  const handleMarkSettlementPaid = async (id: string) => {
    try {
      const res = await adminFetch(`/admin/fee-settlements/${id}/mark-paid`, token, { method: "POST" });
      if (res.ok) {
        toast({ title: "Settlement marked as paid" });
        queryClient.invalidateQueries({ queryKey: ["/admin/fee-settlements"] });
        queryClient.invalidateQueries({ queryKey: ["/api/fee-status"] });
      } else {
        toast({ title: "Error", description: "Failed to update settlement", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to update settlement", variant: "destructive" });
    }
  };

  const formatAtomic = (value: string | null, currency: string) => {
    if (!value || value === "0") return "0";
    const num = parseInt(value, 10);
    if (currency === "XMR") {
      return `${(num / 1e12).toFixed(12)} XMR`;
    }
    return `${num.toLocaleString()} sats`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-admin-title">Admin Panel</h1>
          <p className="text-muted-foreground">Manage fee policies and view reports</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <Shield className="h-3 w-3" />
            Authenticated
          </Badge>
          <Button variant="ghost" size="icon" onClick={onLogout} data-testid="button-admin-logout">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Policies</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-active-policies-count">
              {policiesLoading ? <Skeleton className="h-8 w-16" /> : policies?.filter(p => p.active).length ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Policies</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-policies-count">
              {policiesLoading ? <Skeleton className="h-8 w-16" /> : policies?.length ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Invoices with Fees (30d)</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-invoices-with-fees">
              {reportLoading ? <Skeleton className="h-8 w-16" /> : feeReport?.totalInvoicesWithFees ?? 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {feeReport && feeReport.currencies.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Fee Report</CardTitle>
            <CardDescription>
              {new Date(feeReport.from).toLocaleDateString()} - {new Date(feeReport.to).toLocaleDateString()}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {feeReport.currencies.map((c) => (
                <div key={c.currency} className="p-4 rounded-md bg-muted/50 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{c.currency}</span>
                    <Badge variant="secondary" className="text-xs">{c.totalInvoices} invoices</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Total fees: {formatAtomic(c.totalFeeAtomic, c.currency)}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Avg rate: {parseFloat(c.avgFeePercent).toFixed(2)}%
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {feeStatus && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
            <div>
              <CardTitle className="text-lg">Fee Collection Status</CardTitle>
              <CardDescription>Automatic fee forwarding and settlement tracking</CardDescription>
            </div>
            {feeStatus.invoiceCreationBlocked ? (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" />
                Blocked
              </Badge>
            ) : feeStatus.feeCollectionEnabled ? (
              <Badge variant="default" className="gap-1">
                <CheckCircle className="h-3 w-3" />
                Active
              </Badge>
            ) : (
              <Badge variant="secondary">Not Configured</Badge>
            )}
          </CardHeader>
          <CardContent>
            {feeStatus.invoiceCreationBlocked && (
              <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm mb-4" data-testid="text-fees-overdue-warning">
                Invoice creation is blocked due to overdue fee settlements. Mark outstanding settlements as paid to resume.
              </div>
            )}
            {settlementsLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : !settlements || settlements.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {feeStatus.feeCollectionEnabled
                  ? "No settlements yet. Fees accumulate and settlements are created automatically when the threshold is reached."
                  : "Configure operator wallet addresses in environment variables to enable automatic fee collection."
                }
              </p>
            ) : (
              <div className="space-y-3">
                {settlements.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-4 p-4 rounded-md border flex-wrap" data-testid={`settlement-row-${s.id}`}>
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline">{s.currency}</Badge>
                        <Badge variant={s.status === "paid" ? "default" : s.status === "overdue" ? "destructive" : "secondary"}>
                          {s.status}
                        </Badge>
                        <span className="text-sm text-muted-foreground">{parseInt(s.invoiceCount).toLocaleString()} invoices</span>
                      </div>
                      <div className="text-sm font-medium">
                        {formatAtomic(s.totalFeeAtomic, s.currency)}
                      </div>
                      <div className="text-xs text-muted-foreground flex gap-3 flex-wrap">
                        <span>Created: {new Date(s.createdAt).toLocaleDateString()}</span>
                        {s.dueAt && <span>Due: {new Date(s.dueAt).toLocaleDateString()}</span>}
                        {s.paidAt && <span>Paid: {new Date(s.paidAt).toLocaleDateString()}</span>}
                      </div>
                      {s.operatorAddress && (
                        <div className="text-xs text-muted-foreground font-mono truncate">
                          Pay to: {s.operatorAddress.length > 20 ? `${s.operatorAddress.slice(0, 10)}...${s.operatorAddress.slice(-10)}` : s.operatorAddress}
                        </div>
                      )}
                    </div>
                    {s.status === "pending" && (
                      <Button variant="outline" size="sm" onClick={() => handleMarkSettlementPaid(s.id)} data-testid={`button-mark-paid-${s.id}`}>
                        <Wallet className="h-3 w-3 mr-1" />
                        Mark Paid
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-lg">Fee Policies</CardTitle>
            <CardDescription>Configure service fees applied to new invoices</CardDescription>
          </div>
          <Button onClick={handleCreateNew} className="gap-2" data-testid="button-create-policy">
            <Plus className="h-4 w-4" />
            New Policy
          </Button>
        </CardHeader>
        <CardContent>
          {policiesLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : !policies || policies.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No fee policies configured. Create one to start collecting service fees.
            </div>
          ) : (
            <div className="space-y-3">
              {policies.map((policy) => (
                <div
                  key={policy.id}
                  className="flex items-center justify-between gap-4 p-4 rounded-md border flex-wrap"
                  data-testid={`policy-row-${policy.id}`}
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium" data-testid={`text-policy-name-${policy.id}`}>{policy.name}</span>
                      <Badge variant={policy.active ? "default" : "secondary"}>
                        {policy.active ? "Active" : "Inactive"}
                      </Badge>
                      <Badge variant="outline">{policy.currency}</Badge>
                      {policy.merchantId && (
                        <Badge variant="outline" className="text-xs">
                          Merchant: {policy.merchantId}
                        </Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground flex gap-3 flex-wrap">
                      <span>{parseFloat(policy.feePercent).toFixed(2)}%</span>
                      {policy.fixedFeeAtomic !== "0" && <span>+ {parseInt(policy.fixedFeeAtomic).toLocaleString()} fixed</span>}
                      {policy.minFeeAtomic !== "0" && <span>Min: {parseInt(policy.minFeeAtomic).toLocaleString()}</span>}
                      {policy.maxFeeAtomic && <span>Max: {parseInt(policy.maxFeeAtomic).toLocaleString()}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => handleEdit(policy)} data-testid={`button-edit-policy-${policy.id}`}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeletingPolicy(policy)} data-testid={`button-delete-policy-${policy.id}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <PolicyForm
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        token={token}
        editingPolicy={editingPolicy}
        onSuccess={handleFormSuccess}
      />

      <AlertDialog open={!!deletingPolicy} onOpenChange={() => setDeletingPolicy(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete fee policy?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{deletingPolicy?.name}". Existing invoices that used this policy will not be affected, but new invoices will no longer have this fee applied.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} data-testid="button-confirm-delete">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function Admin() {
  const [token, setToken] = useState(() => sessionStorage.getItem("admin_token") || "");

  const handleLogout = useCallback(() => {
    sessionStorage.removeItem("admin_token");
    setToken("");
  }, []);

  if (!token) {
    return <AdminAuth onAuthenticate={setToken} />;
  }

  return <AdminDashboard token={token} onLogout={handleLogout} />;
}
