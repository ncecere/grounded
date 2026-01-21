import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { TestSuitesTab } from "@/components/agents/tabs/TestSuitesTab";

interface AgentTestSuitesProps {
  agentId: string;
  onBack: () => void;
  onViewSuite?: (suiteId: string) => void;
}

export function AgentTestSuites({ agentId, onBack, onViewSuite }: AgentTestSuitesProps) {
  const { data: agent } = useQuery({
    queryKey: ["agent", agentId],
    queryFn: () => api.getAgent(agentId),
  });

  const agentName = agent?.name ?? "Agent";
  const title = `${agentName} \u00b7 Test Suites`;

  return (
    <div className="p-6">
      <PageHeader title={title} backButton={{ onClick: onBack }} />
      <TestSuitesTab agentId={agentId} agentName={agent?.name} showHeader={false} onViewSuite={onViewSuite} />
    </div>
  );
}
