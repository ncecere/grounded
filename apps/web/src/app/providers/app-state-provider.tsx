import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Page } from "../../components/app-sidebar";
import { clearCurrentTenantId, getCurrentTenantId, setCurrentTenantId } from "../../lib/api/client";

const ADMIN_MODE_KEY = "grounded_admin_mode";
const ADMIN_PAGE_KEY = "grounded_admin_page";

type AppStateContextValue = {
  currentPage: Page;
  selectedKbId: string | null;
  selectedAgentId: string | null;
  selectedSharedKbId: string | null;
  selectedSuiteId: string | null;
  isAdminMode: boolean;
  setCurrentPage: (page: Page) => void;
  setSelectedKbId: (id: string | null) => void;
  setSelectedAgentId: (id: string | null) => void;
  setSelectedSharedKbId: (id: string | null) => void;
  setSelectedSuiteId: (id: string | null) => void;
  resetSelections: () => void;
  navigate: (page: Page) => void;
  resetForTenantChange: () => void;
  enterAdminMode: (targetPage?: Page) => void;
  exitAdminMode: () => void;
};

const AppStateContext = createContext<AppStateContextValue | null>(null);

export function AppStateProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();

  // Restore admin mode from sessionStorage on initial load
  const [isAdminMode, setIsAdminMode] = useState(() =>
    sessionStorage.getItem(ADMIN_MODE_KEY) === "true"
  );
  const [currentPage, setCurrentPage] = useState<Page>(() => {
    if (sessionStorage.getItem(ADMIN_MODE_KEY) === "true") {
      return (sessionStorage.getItem(ADMIN_PAGE_KEY) as Page) || "dashboard";
    }
    return "kbs";
  });

  const [selectedKbId, setSelectedKbId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedSharedKbId, setSelectedSharedKbId] = useState<string | null>(null);
  const [selectedSuiteId, setSelectedSuiteId] = useState<string | null>(null);

  // Save tenant ID before entering admin mode so we can restore it on exit
  const savedTenantIdRef = useRef<string | null>(null);

  const resetSelections = useCallback(() => {
    setSelectedKbId(null);
    setSelectedAgentId(null);
    setSelectedSharedKbId(null);
    setSelectedSuiteId(null);
  }, []);

  const navigate = useCallback(
    (page: Page) => {
      setCurrentPage(page);
      resetSelections();
      // Keep sessionStorage in sync when navigating within admin mode
      if (sessionStorage.getItem(ADMIN_MODE_KEY) === "true") {
        sessionStorage.setItem(ADMIN_PAGE_KEY, page);
      }
    },
    [resetSelections]
  );

  const resetForTenantChange = useCallback(() => {
    resetSelections();
    setCurrentPage("kbs");
  }, [resetSelections]);

  const enterAdminMode = useCallback(
    (targetPage: Page = "dashboard") => {
      // Save the current tenant ID so we can restore it on exit
      savedTenantIdRef.current = getCurrentTenantId();
      clearCurrentTenantId();

      setIsAdminMode(true);
      resetSelections();
      setCurrentPage(targetPage);

      // Persist to sessionStorage
      sessionStorage.setItem(ADMIN_MODE_KEY, "true");
      sessionStorage.setItem(ADMIN_PAGE_KEY, targetPage);

      // Invalidate workspace queries since we cleared the tenant header
      queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
    },
    [resetSelections, queryClient]
  );

  const exitAdminMode = useCallback(() => {
    // Restore the saved tenant ID only if it's still valid.
    // We write it to localStorage so TenantProvider's useEffect can
    // validate it against the fresh tenant list. If the tenant was
    // deleted during the admin session, the useEffect will not find
    // it and will auto-select tenants[0] instead.
    if (savedTenantIdRef.current) {
      setCurrentTenantId(savedTenantIdRef.current);
      savedTenantIdRef.current = null;
    }

    setIsAdminMode(false);
    resetSelections();
    setCurrentPage("kbs");

    // Clear sessionStorage
    sessionStorage.removeItem(ADMIN_MODE_KEY);
    sessionStorage.removeItem(ADMIN_PAGE_KEY);

    // Force refetch tenant list so TenantProvider validates against
    // the current state (tenants may have been created/deleted in admin mode)
    queryClient.invalidateQueries({ queryKey: ["my-tenants"] });

    // Invalidate workspace and admin queries so data is fresh
    queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
    queryClient.invalidateQueries({ queryKey: ["agents"] });
    queryClient.invalidateQueries({ queryKey: ["analytics"] });
    queryClient.invalidateQueries({ queryKey: ["admin"] });
  }, [resetSelections, queryClient]);

  const value = useMemo<AppStateContextValue>(
    () => ({
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
      resetSelections,
      navigate,
      resetForTenantChange,
      enterAdminMode,
      exitAdminMode,
    }),
    [
      currentPage,
      selectedKbId,
      selectedAgentId,
      selectedSharedKbId,
      selectedSuiteId,
      isAdminMode,
      resetSelections,
      navigate,
      resetForTenantChange,
      enterAdminMode,
      exitAdminMode,
    ]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export const useAppState = () => {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error("useAppState must be used within an AppStateProvider");
  }
  return context;
};
