import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import Dashboard from "@/pages/dashboard";
import CreateInvoice from "@/pages/create-invoice";
import InvoiceDetail from "@/pages/invoice-detail";
import Templates from "@/pages/templates";
import ApiDocs from "@/pages/api-docs";
import Admin from "@/pages/admin";
import Setup from "@/pages/setup";
import NotFound from "@/pages/not-found";
import { FileText, BookOpen, Plus, Layers, Shield, Zap, HelpCircle } from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { AdminAuthContext, useAdminAuth } from "@/contexts/admin-auth";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/create" component={CreateInvoice} />
      <Route path="/invoice/:id" component={InvoiceDetail} />
      <Route path="/templates" component={Templates} />
      <Route path="/admin" component={Admin} />
      <Route path="/api-docs" component={ApiDocs} />
      <Route path="/setup" component={Setup} />
      <Route component={NotFound} />
    </Switch>
  );
}

function Header() {
  const [location] = useLocation();
  const { isAdminAuthed } = useAdminAuth();

  const navItems = [
    { path: "/", label: "Dashboard", icon: FileText },
    { path: "/create", label: "New Invoice", icon: Plus },
    { path: "/templates", label: "Templates", icon: Layers },
    { path: "/api-docs", label: "API Docs", icon: BookOpen },
    { path: "/setup", label: "Setup", icon: HelpCircle },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="container mx-auto px-6 h-16 flex items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <Link href="/">
            <div className="flex items-center gap-2.5 cursor-pointer rounded-lg px-2 py-1.5 -ml-2 hover:bg-muted/50 transition-colors">
              <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center shadow-sm">
                <Zap className="h-4 w-4 text-white" strokeWidth={2.5} />
              </div>
              <span className="font-bold text-lg tracking-tight hidden sm:inline">Rudis</span>
            </div>
          </Link>

          <nav className="hidden sm:flex items-center gap-0.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location === item.path || (item.path !== "/" && location.startsWith(item.path));
              return (
                <Link key={item.path} href={item.path}>
                  <Button
                    variant={isActive ? "secondary" : "ghost"}
                    size="sm"
                    className={`gap-2 text-sm ${isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    data-testid={`nav-${item.label.toLowerCase().replace(/\s/g, "-")}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {item.label}
                  </Button>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {/* Admin link — only visible once authenticated */}
          {isAdminAuthed && (
            <Link href="/admin">
              <Button
                variant={location === "/admin" ? "secondary" : "ghost"}
                size="sm"
                className="gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <Shield className="h-3.5 w-3.5" />
                Admin
              </Button>
            </Link>
          )}
          {!isAdminAuthed && (
            <Link href="/admin">
              <Button
                variant="ghost"
                size="sm"
                className="gap-2 text-sm text-muted-foreground/50 hover:text-muted-foreground"
                title="Admin"
              >
                <Shield className="h-3.5 w-3.5" />
              </Button>
            </Link>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

function App() {
  const [isAdminAuthed, setAdminAuthed] = useState<boolean>(() => {
    return !!sessionStorage.getItem("admin_token");
  });

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark" storageKey="rudis-theme">
        <TooltipProvider>
          <AdminAuthContext.Provider value={{ isAdminAuthed, setAdminAuthed }}>
            <div className="min-h-screen bg-background text-foreground">
              <Header />
              <main className="container mx-auto px-6 py-8">
                <Router />
              </main>
            </div>
            <Toaster />
          </AdminAuthContext.Provider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
