import { Suspense, lazy, useEffect } from "react";
import type { UserTenant } from "./lib/api";
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
import { Building2, AlertTriangle, Shield } from "lucide-react";
import { Button } from "./components/ui/button";
import { canAccessPage, pageRegistryById, type PageId } from "./app/page-registry";
import { useAppState, useAuth, useTenant } from "./app/providers";

const KnowledgeBases = lazy(() =>
  import("./pages/KnowledgeBases").then((m) => ({ default: m.KnowledgeBases }))
);
const Agents = lazy(() =>
  import("./pages/Agents").then((m) => ({ default: m.Agents }))
);
const Sources = lazy(() =>
  import("./pages/Sources").then((m) => ({ default: m.Sources }))
);
const Chat = lazy(() =>
  import("./pages/Chat").then((m) => ({ default: m.Chat }))
);
const AgentTestSuites = lazy(() =>
  import("./pages/AgentTestSuites").then((m) => ({ default: m.AgentTestSuites }))
);
const AgentTestSuiteDetail = lazy(() =>
  import("./pages/AgentTestSuiteDetail").then((m) => ({ default: m.AgentTestSuiteDetail }))
);
const AdminSharedKBs = lazy(() =>
  import("./pages/AdminSharedKBs").then((m) => ({ default: m.AdminSharedKBs }))
);
const AdminSharedKbSources = lazy(() =>
  import("./pages/AdminSharedKbSources").then((m) => ({ default: m.AdminSharedKbSources }))
);
const SharedKbDetail = lazy(() =>
  import("./pages/SharedKbDetail").then((m) => ({ default: m.SharedKbDetail }))
);
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const Login = lazy(() =>
  import("./pages/Login").then((m) => ({ default: m.Login }))
);

const customPageIds = new Set<Page>([
  "kbs",
  "sources",
  "shared-kb-detail",
  "agents",
  "chat",
  "test-suites",
  "test-suite-detail",
  "dashboard",
  "shared-kbs",
  "shared-kb-sources",
]);

function PageLoadingFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-b-2 border-primary" />
        <p className="mt-3 text-sm text-muted-foreground">Loading page...</p>
      </div>
    </div>
  );
}

export default function App() {
  const {
    currentPage,
    selectedKbId,
    selectedAgentId,
    selectedSharedKbId,
    selectedSuiteId,
    isAdminMode,
    setCurrentPage,
    setSelectedKbId,
    setSelectedAgentId,
    setSelectedSharedKbId,
    setSelectedSuiteId,
    navigate,
    resetForTenantChange,
    enterAdminMode,
    exitAdminMode,
  } = useAppState();
  const { user, isLoading: userLoading, hasToken, refreshUser, logout } = useAuth();
  const {
    tenants,
    currentTenant,
    isLoading: tenantsLoading,
    hasTenant,
    canManageTenant,
    selectTenant,
  } = useTenant();

  // Auto-enter admin mode for admins with no tenants
  useEffect(() => {
    if (user?.isSystemAdmin && !tenantsLoading && tenants.length === 0 && !isAdminMode) {
      enterAdminMode();
    }
  }, [user?.isSystemAdmin, tenantsLoading, tenants.length, isAdminMode, enterAdminMode]);

  const handleTenantChange = (tenant: UserTenant) => {
    selectTenant(tenant);
    resetForTenantChange();
  };

  const handleLogout = () => {
    logout();
  };

  const handleNavigate = (page: Page) => {
    navigate(page);
  };

  const renderRegistryPage = (page: Page) => {
    if (customPageIds.has(page)) {
      return null;
    }

    const entry = pageRegistryById[page as PageId];

    if (!entry) {
      return null;
    }

    const hasAccess = canAccessPage(entry, {
      hasTenant,
      canManageTenant: !!canManageTenant,
      isSystemAdmin: user?.isSystemAdmin,
    });

    if (!hasAccess) {
      return null;
    }

    const PageComponent = entry.component;
    return <PageComponent />;
  };

  // Loading states
  if ((userLoading && hasToken) || (user && tenantsLoading)) {
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
  if (!user || !hasToken) {
    return (
      <Suspense fallback={<PageLoadingFallback />}>
        <Login onSuccess={() => refreshUser()} />
      </Suspense>
    );
  }

  const renderAdminPage = () => {
    // Admin mode: render admin pages
    switch (currentPage) {
      case "dashboard":
        return <AdminDashboard onNavigate={setCurrentPage} />;
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
      default: {
        const registryPage = renderRegistryPage(currentPage);
        if (registryPage) {
          return registryPage;
        }
        // Fallback to dashboard if we're on an unrecognized admin page
        return <AdminDashboard onNavigate={setCurrentPage} />;
      }
    }
  };

  const renderWorkspacePage = () => {
    // No tenant state for non-admin users
    if (tenants.length === 0 && !user.isSystemAdmin) {
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

    // No tenant state for admin users - prompt to go to admin panel
    if (tenants.length === 0 && user.isSystemAdmin) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Building2 className="w-8 h-8 text-blue-600" />
            </div>
            <h2 className="text-xl font-semibold mb-2">No Tenants Yet</h2>
            <p className="text-muted-foreground mb-6">
              Get started by creating your first tenant in the Admin Panel.
            </p>
            <Button onClick={enterAdminMode}>
              <Shield className="mr-2 h-4 w-4" />
              Open Admin Panel
            </Button>
          </div>
        </div>
      );
    }

    // Normal workspace page rendering
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
            onViewSuite={(suiteId) => {
              setSelectedSuiteId(suiteId);
              setCurrentPage("test-suite-detail");
            }}
          />
        );
      case "test-suite-detail":
        return (
          <AgentTestSuiteDetail
            suiteId={selectedSuiteId!}
            agentId={selectedAgentId!}
            onBack={() => {
              setSelectedSuiteId(null);
              setCurrentPage("test-suites");
            }}
          />
        );
      default: {
        const registryPage = renderRegistryPage(currentPage);
        if (registryPage) {
          return registryPage;
        }

        return <KnowledgeBases onSelectKb={() => {}} />;
      }
    }
  };

  const renderPage = () => {
    if (isAdminMode && user.isSystemAdmin) {
      return renderAdminPage();
    }
    return renderWorkspacePage();
  };

  const currentEntry = pageRegistryById[currentPage as PageId];

  return (
    <SidebarProvider>
        <AppSidebar
          user={user}
          currentPage={currentPage}
          onNavigate={handleNavigate}
          onLogout={handleLogout}
          tenants={tenants}
          currentTenant={currentTenant}
          onTenantChange={handleTenantChange}
          isAdminMode={isAdminMode}
          onEnterAdminMode={enterAdminMode}
          onExitAdminMode={exitAdminMode}
        />
      <SidebarInset className="overflow-hidden">
        {currentPage === "chat" ? (
          // Chat page - no header, full height for chat component
          <div className="h-full flex flex-col overflow-hidden">
            <Suspense fallback={<PageLoadingFallback />}>
              {renderPage()}
            </Suspense>
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
                      <BreadcrumbPage>{currentEntry?.label ?? "Page"}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
            </header>
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex-1 overflow-auto p-4">
                <Suspense fallback={<PageLoadingFallback />}>
                  {renderPage()}
                </Suspense>
              </div>
            </div>
          </>
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}
