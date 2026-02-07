import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import type { Page } from "../../components/app-sidebar";

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
  enterAdminMode: () => void;
  exitAdminMode: () => void;
};

const AppStateContext = createContext<AppStateContextValue | null>(null);

export function AppStateProvider({ children }: PropsWithChildren) {
  const [currentPage, setCurrentPage] = useState<Page>("kbs");
  const [selectedKbId, setSelectedKbId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedSharedKbId, setSelectedSharedKbId] = useState<string | null>(null);
  const [selectedSuiteId, setSelectedSuiteId] = useState<string | null>(null);
  const [isAdminMode, setIsAdminMode] = useState(false);

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
    },
    [resetSelections]
  );

  const resetForTenantChange = useCallback(() => {
    resetSelections();
    setCurrentPage("kbs");
  }, [resetSelections]);

  const enterAdminMode = useCallback(() => {
    setIsAdminMode(true);
    resetSelections();
    setCurrentPage("dashboard");
  }, [resetSelections]);

  const exitAdminMode = useCallback(() => {
    setIsAdminMode(false);
    resetSelections();
    setCurrentPage("kbs");
  }, [resetSelections]);

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
