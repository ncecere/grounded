import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getToken, clearToken, getCurrentTenantId, setCurrentTenantId, clearCurrentTenantId, type UserTenant } from "./lib/api";
import { AppSidebar, type Page } from "./components/app-sidebar";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "./components/ui/sidebar";
import { Separator } from "./components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "./components/ui/breadcrumb";
import { KnowledgeBases } from "./pages/KnowledgeBases";
import { Agents } from "./pages/Agents";
import { Sources } from "./pages/Sources";
import { Chat } from "./pages/Chat";
import { AgentTestSuites } from "./pages/AgentTestSuites";
import { Analytics } from "./pages/Analytics";
import { AdminSettings } from "./pages/AdminSettings";
import { AdminTenants } from "./pages/AdminTenants";
import { AdminModels } from "./pages/AdminModels";
import { AdminUsers } from "./pages/AdminUsers";
import { AdminSharedKBs } from "./pages/AdminSharedKBs";
import { AdminSharedKbSources } from "./pages/AdminSharedKbSources";
import { SharedKbDetail } from "./pages/SharedKbDetail";
import AdminDashboard from "./pages/AdminDashboard";
import { AdminAnalytics } from "./pages/AdminAnalytics";
import { TenantSettings } from "./pages/TenantSettings";

import { AdminAuditLogs } from "./pages/AdminAuditLogs";
import { Login } from "./pages/Login";
import { Building2, AlertTriangle } from "lucide-react";
import { Button } from "./components/ui/button";

const pageNames: Record<Page, string> = {
  kbs: "Knowledge Bases",
  agents: "Agents",
  sources: "Sources",
  chat: "Chat",
  "test-suites": "Test Suites",
  analytics: "Analytics",
  dashboard: "Dashboard",
  settings: "Settings",
  tenants: "Tenants",
  models: "AI Models",
  users: "Users",
  "shared-kbs": "Shared Knowledge Bases",
  "shared-kb-sources": "Shared KB Sources",
  "shared-kb-detail": "Shared Knowledge Base",
  "admin-analytics": "Analytics",
  "tenant-settings": "Tenant Settings",
  "admin-audit-logs": "Audit Logs",
};

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>("kbs");
  const [selectedKbId, setSelectedKbId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedSharedKbId, setSelectedSharedKbId] = useState<string | null>(null);
  const [currentTenant, setCurrentTenant] = useState<UserTenant | null>(null);
  const queryClient = useQueryClient();

  const { data: user, isLoading: userLoading, refetch } = useQuery({
    queryKey: ["me"],
    queryFn: api.getMe,
    retry: false,
    enabled: !!getToken(),
  });

  const { data: tenantsData, isLoading: tenantsLoading } = useQuery({
    queryKey: ["my-tenants"],
    queryFn: api.getMyTenants,
    enabled: !!user,
  });

  // Set initial tenant from localStorage or first available
  useEffect(() => {
    if (tenantsData?.tenants && tenantsData.tenants.length > 0) {
      const savedTenantId = getCurrentTenantId();
      const savedTenant = savedTenantId
        ? tenantsData.tenants.find((t) => t.id === savedTenantId)
        : null;

      if (savedTenant) {
        setCurrentTenant(savedTenant);
      } else {
        setCurrentTenant(tenantsData.tenants[0]);
        setCurrentTenantId(tenantsData.tenants[0].id);
      }
    }
  }, [tenantsData]);

  const handleTenantChange = (tenant: UserTenant) => {
    setCurrentTenant(tenant);
    setCurrentTenantId(tenant.id);
    queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
    queryClient.invalidateQueries({ queryKey: ["agents"] });
    queryClient.invalidateQueries({ queryKey: ["analytics"] });
    setSelectedKbId(null);
    setSelectedAgentId(null);
    setCurrentPage("kbs");
  };

  const handleLogout = () => {
    clearCurrentTenantId();
    clearToken();
    setCurrentTenant(null);
    refetch();
  };

  const handleNavigate = (page: Page) => {
    setCurrentPage(page);
    setSelectedKbId(null);
    setSelectedAgentId(null);
    setSelectedSharedKbId(null);
  };

  // Loading states
  if ((userLoading && getToken()) || (user && tenantsLoading)) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Not logged in
  if (!user || !getToken()) {
    return <Login onSuccess={() => refetch()} />;
  }

  const renderPage = () => {
    // No tenant state for non-admin users
    if ((!tenantsData?.tenants || tenantsData.tenants.length === 0) && !user.isSystemAdmin) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-yellow-600" />
            </div>
            <h2 className="text-xl font-semibold mb-2">No Access</h2>
            <p className="text-muted-foreground mb-6">
              You don't have access to any tenants yet. Please contact your administrator to be added to a tenant.
            </p>
          </div>
        </div>
      );
    }

    // No tenant state for admin users - prompt to create
    if ((!tenantsData?.tenants || tenantsData.tenants.length === 0) && user.isSystemAdmin) {
      if (currentPage === "dashboard") return <AdminDashboard onNavigate={setCurrentPage} />;
      if (currentPage === "admin-analytics") return <AdminAnalytics />;
      if (currentPage === "tenants") return <AdminTenants />;
      if (currentPage === "users") return <AdminUsers />;
      if (currentPage === "settings") return <AdminSettings />;
      if (currentPage === "models") return <AdminModels />;
      if (currentPage === "shared-kbs") return (
        <AdminSharedKBs
          onSelectKb={(id) => {
            setSelectedSharedKbId(id);
            setCurrentPage("shared-kb-sources");
          }}
        />
      );
      if (currentPage === "shared-kb-sources") return (
        <AdminSharedKbSources
          kbId={selectedSharedKbId!}
          onBack={() => {
            setSelectedSharedKbId(null);
            setCurrentPage("shared-kbs");
          }}
        />
      );
      if (currentPage === "admin-audit-logs") return <AdminAuditLogs />;

      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Building2 className="w-8 h-8 text-blue-600" />
            </div>
            <h2 className="text-xl font-semibold mb-2">No Tenants Yet</h2>
            <p className="text-muted-foreground mb-6">
              Get started by creating your first tenant.
            </p>
            <Button onClick={() => setCurrentPage("tenants")}>
              Go to Tenants
            </Button>
          </div>
        </div>
      );
    }

    // Normal page rendering
    switch (currentPage) {
      case "kbs":
        return (
          <KnowledgeBases
            onSelectKb={(id, isShared) => {
              setSelectedKbId(id);
              if (isShared) {
                setCurrentPage("shared-kb-detail");
              } else {
                setCurrentPage("sources");
              }
            }}
          />
        );
      case "sources":
        return (
          <Sources
            kbId={selectedKbId!}
            onBack={() => {
              setSelectedKbId(null);
              setCurrentPage("kbs");
            }}
          />
        );
      case "shared-kb-detail":
        return (
          <SharedKbDetail
            kbId={selectedKbId!}
            onBack={() => {
              setSelectedKbId(null);
              setCurrentPage("kbs");
            }}
          />
        );
      case "agents":
        return (
          <Agents
            onSelectAgent={(id) => {
              setSelectedAgentId(id);
              setCurrentPage("chat");
            }}
            onOpenTestSuites={(id) => {
              setSelectedAgentId(id);
              setCurrentPage("test-suites");
            }}
          />
        );
      case "chat":
        return (
          <Chat
            agentId={selectedAgentId!}
            onBack={() => {
              setSelectedAgentId(null);
              setCurrentPage("agents");
            }}
          />
        );
      case "test-suites":
        return (
          <AgentTestSuites
            agentId={selectedAgentId!}
            onBack={() => {
              setSelectedAgentId(null);
              setCurrentPage("agents");
            }}
          />
        );
      case "analytics":
        return <Analytics />;
      case "dashboard":
        return <AdminDashboard onNavigate={setCurrentPage} />;
      case "tenants":
        return <AdminTenants />;
      case "users":
        return <AdminUsers />;
      case "shared-kbs":
        return (
          <AdminSharedKBs
            onSelectKb={(id) => {
              setSelectedSharedKbId(id);
              setCurrentPage("shared-kb-sources");
            }}
          />
        );
      case "shared-kb-sources":
        return (
          <AdminSharedKbSources
            kbId={selectedSharedKbId!}
            onBack={() => {
              setSelectedSharedKbId(null);
              setCurrentPage("shared-kbs");
            }}
          />
        );
      case "models":
        return <AdminModels />;
      case "admin-analytics":
        return <AdminAnalytics />;
      case "settings":
        return <AdminSettings />;
      case "tenant-settings":
        return <TenantSettings />;
      case "admin-audit-logs":
        return <AdminAuditLogs />;
      default:
        return <KnowledgeBases onSelectKb={() => {}} />;
    }
  };

  return (
    <SidebarProvider>
      <AppSidebar
        user={user}
        currentPage={currentPage}
        onNavigate={handleNavigate}
        onLogout={handleLogout}
        tenants={tenantsData?.tenants}
        currentTenant={currentTenant}
        onTenantChange={handleTenantChange}
      />
      <SidebarInset className="overflow-hidden">
        {currentPage === "chat" ? (
          // Chat page - no header, full height for chat component
          <div className="h-full flex flex-col overflow-hidden">
            {renderPage()}
          </div>
        ) : (
          // Other pages - with header and scrollable content
          <>
            <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
              <div className="flex items-center gap-2">
                <SidebarTrigger className="-ml-1" />
                <Separator orientation="vertical" className="mr-2 h-4" />
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem>
                      <BreadcrumbPage>{pageNames[currentPage]}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
            </header>
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex-1 overflow-auto p-4">
                {renderPage()}
              </div>
            </div>
          </>
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}
