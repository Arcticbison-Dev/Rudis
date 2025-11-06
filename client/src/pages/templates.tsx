import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type Template, type InsertTemplate, insertTemplateSchema } from "@shared/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from "wouter";

export default function Templates() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState<"BTC" | "Lightning" | "XMR">("BTC");

  const { data: templates, isLoading } = useQuery<Template[]>({
    queryKey: ["/api/templates"],
  });

  const currencies = [
    { value: "BTC", label: "Bitcoin (BTC)" },
    { value: "Lightning", label: "Lightning Network" },
    { value: "XMR", label: "Monero (XMR)" },
  ] as const;

  const form = useForm<InsertTemplate>({
    resolver: zodResolver(insertTemplateSchema),
    defaultValues: {
      name: "",
      description: "",
      amount: "",
      currency: "BTC",
      paymentAddress: "",
      expiresInHours: "",
    },
  });

  const createTemplateMutation = useMutation({
    mutationFn: async (data: InsertTemplate) => {
      const response = await apiRequest("POST", "/api/templates", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
      toast({
        title: "Template created!",
        description: "Your template has been saved successfully.",
      });
      setIsCreateDialogOpen(false);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Failed to create template",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const updateTemplateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: InsertTemplate }) => {
      const response = await apiRequest("PATCH", `/api/templates/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
      toast({
        title: "Template updated!",
        description: "Your template has been updated successfully.",
      });
      setEditingTemplate(null);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Failed to update template",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
      toast({
        title: "Template deleted",
        description: "The template has been removed.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to delete template",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const handleCreateTemplate = (data: InsertTemplate) => {
    createTemplateMutation.mutate(data);
  };

  const handleUpdateTemplate = (data: InsertTemplate) => {
    if (editingTemplate) {
      updateTemplateMutation.mutate({ id: editingTemplate.id, data });
    }
  };

  const handleDeleteTemplate = (id: string, name: string) => {
    if (window.confirm(`Are you sure you want to delete "${name}"?`)) {
      deleteTemplateMutation.mutate(id);
    }
  };

  const handleEditClick = (template: Template) => {
    setEditingTemplate(template);
    const currency = template.currency as "BTC" | "Lightning" | "XMR";
    setSelectedCurrency(currency);
    form.reset({
      name: template.name,
      description: template.description || "",
      amount: template.amount || "",
      currency: currency,
      paymentAddress: template.paymentAddress || "",
      expiresInHours: template.expiresInHours || "",
    });
  };

  const handleCreateFromTemplate = (template: Template) => {
    const invoiceData: any = {
      amount: template.amount || "",
      currency: template.currency,
      paymentAddress: template.paymentAddress || "",
      description: template.description || "",
    };

    // Only add expiresAt if template has valid expiresInHours
    if (template.expiresInHours && !isNaN(parseInt(template.expiresInHours))) {
      const hours = parseInt(template.expiresInHours);
      invoiceData.expiresAt = new Date(Date.now() + hours * 3600000).toISOString();
    }
    
    setLocation(`/create?template=${encodeURIComponent(JSON.stringify(invoiceData))}`);
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto space-y-8">
        <Skeleton className="h-12 w-64" />
        <div className="grid gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight" data-testid="heading-templates">
            Invoice Templates
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            Create reusable templates for common invoice types
          </p>
        </div>
        <Button onClick={() => setIsCreateDialogOpen(true)} data-testid="button-create-template">
          <Plus className="h-4 w-4 mr-2" />
          New Template
        </Button>
      </div>

      {templates && templates.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No templates yet</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-md">
              Create your first template to quickly generate invoices with pre-filled information.
            </p>
            <Button onClick={() => setIsCreateDialogOpen(true)} data-testid="button-create-first-template">
              <Plus className="h-4 w-4 mr-2" />
              Create Template
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {templates?.map((template) => (
            <Card key={template.id} data-testid={`template-card-${template.id}`}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <CardTitle className="flex items-center gap-2">
                      {template.name}
                      <Badge variant="outline" className="font-mono text-xs">
                        {template.currency}
                      </Badge>
                    </CardTitle>
                    {template.description && (
                      <CardDescription className="mt-2">{template.description}</CardDescription>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleCreateFromTemplate(template)}
                      data-testid={`button-use-template-${template.id}`}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleEditClick(template)}
                      data-testid={`button-edit-template-${template.id}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleDeleteTemplate(template.id, template.name)}
                      data-testid={`button-delete-template-${template.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  {template.amount && (
                    <div>
                      <div className="text-muted-foreground mb-1">Amount</div>
                      <div className="font-mono font-medium">{template.amount}</div>
                    </div>
                  )}
                  {template.paymentAddress && (
                    <div className="col-span-2">
                      <div className="text-muted-foreground mb-1">Payment Address</div>
                      <div className="font-mono text-xs truncate">{template.paymentAddress}</div>
                    </div>
                  )}
                  {template.expiresInHours && (
                    <div>
                      <div className="text-muted-foreground mb-1">Expires In</div>
                      <div className="font-medium">{template.expiresInHours}h</div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog
        open={isCreateDialogOpen || !!editingTemplate}
        onOpenChange={(open) => {
          if (!open) {
            setIsCreateDialogOpen(false);
            setEditingTemplate(null);
            form.reset();
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? "Edit Template" : "Create Template"}</DialogTitle>
            <DialogDescription>
              {editingTemplate
                ? "Update your invoice template"
                : "Create a reusable template for common invoice types"}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(editingTemplate ? handleUpdateTemplate : handleCreateTemplate)}
              className="space-y-6"
            >
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Template Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Monthly Subscription" {...field} data-testid="input-template-name" />
                    </FormControl>
                    <FormDescription>A descriptive name for this template</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description (Optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Additional details about this template"
                        {...field}
                        value={field.value || ""}
                        data-testid="input-template-description"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

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
                            data-testid={`button-template-currency-${currency.value.toLowerCase()}`}
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

              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        placeholder="0.00000000"
                        {...field}
                        data-testid="input-template-amount"
                      />
                    </FormControl>
                    <FormDescription>Leave empty to enter amount when creating invoice</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="paymentAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment Address (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        placeholder="Enter crypto address"
                        className="font-mono text-sm"
                        {...field}
                        value={field.value || ""}
                        data-testid="input-template-address"
                      />
                    </FormControl>
                    <FormDescription>Leave empty to enter address when creating invoice</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="expiresInHours"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Expires In (Hours, Optional)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="24"
                        {...field}
                        value={field.value || ""}
                        data-testid="input-template-expires"
                      />
                    </FormControl>
                    <FormDescription>How many hours until invoices created from this template expire</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsCreateDialogOpen(false);
                    setEditingTemplate(null);
                    form.reset();
                  }}
                  data-testid="button-cancel-template"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createTemplateMutation.isPending || updateTemplateMutation.isPending}
                  data-testid="button-save-template"
                >
                  {(createTemplateMutation.isPending || updateTemplateMutation.isPending) && "Saving..."}
                  {!createTemplateMutation.isPending && !updateTemplateMutation.isPending && (editingTemplate ? "Update" : "Create")}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
