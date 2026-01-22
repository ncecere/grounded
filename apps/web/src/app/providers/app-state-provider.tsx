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
  setCurrentPage: (page: Page) => void;
  setSelectedKbId: (id: string | null) => void;
  setSelectedAgentId: (id: string | null) => void;
  setSelectedSharedKbId: (id: string | null) => void;
  setSelectedSuiteId: (id: string | null) => void;
  resetSelections: () => void;
  navigate: (page: Page) => void;
  resetForTenantChange: () => void;
};

const AppStateContext = createContext<AppStateContextValue | null>(null);

export function AppStateProvider({ children }: PropsWithChildren) {
  const [currentPage, setCurrentPage] = useState<Page>("kbs");
  const [selectedKbId, setSelectedKbId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedSharedKbId, setSelectedSharedKbId] = useState<string | null>(null);
  const [selectedSuiteId, setSelectedSuiteId] = useState<string | null>(null);

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

  const value = useMemo<AppStateContextValue>(
    () => ({
      currentPage,
      selectedKbId,
      selectedAgentId,
      selectedSharedKbId,
      selectedSuiteId,
      setCurrentPage,
      setSelectedKbId,
      setSelectedAgentId,
      setSelectedSharedKbId,
      setSelectedSuiteId,
      resetSelections,
      navigate,
      resetForTenantChange,
    }),
    [
      currentPage,
      selectedKbId,
      selectedAgentId,
      selectedSharedKbId,
      selectedSuiteId,
      resetSelections,
      navigate,
      resetForTenantChange,
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
