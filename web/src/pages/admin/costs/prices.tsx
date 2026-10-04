/*
 * Costs › Prices: every priced model and MCP server with its prices today and "Unpriced" where one is missing. A model
 * opens its record, where prices are changed; an MCP server opens its record, where its price per call is set.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Tags } from "lucide-react";
import { api, unwrap, type Schemas } from "@/api/client";
import { ListPage } from "@/components/templates/list-page";
import { Badge } from "@/components/ui/badge/badge";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import type { Facet } from "@/components/ui/filter-bar/filter-bar";
import { TextLink } from "@/components/ui/text-link/text-link";
import { unitLabels } from "@/lib/costs";
import { formatMoneyExact } from "@/lib/format";
import { kindLabels } from "../models/common";
import c from "./costs.module.css";
import { UnpricedBadge } from "./overview";

type Item = Schemas["CostPriceItem"];

export const pricesQuery = () => ({
  queryKey: ["admin", "costs", "prices"],
  queryFn: async () => unwrap(await api.GET("/v1/admin/costs/prices")),
});

const facets: Facet<Item>[] = [
  {
    id: "priced",
    label: "Prices",
    type: "toggle",
    allLabel: "All",
    accessor: (r) => (r.unpriced ? "unpriced" : "priced"),
    options: [
      { value: "unpriced", label: "Unpriced" },
      { value: "priced", label: "Priced" },
    ],
  },
];

/** A model's prices today, one line per unit. */
export function PriceLines({ current, currency }: { current: Schemas["UnitPrice"][]; currency: string }) {
  return (
    <ul className={c.prices}>
      {current.map((p) => (
        <li key={p.unit} className={c.priceLine}>
          <span>{unitLabels[p.unit].label}:</span>
          {p.price === null ? <UnpricedBadge /> : <strong>{formatMoneyExact(p.price, currency)}</strong>}
          <span className={c.per}>{unitLabels[p.unit].per}</span>
        </li>
      ))}
    </ul>
  );
}

// ?from= gives the model's record page a "Back to Costs" link.
const modelLink = (id: string) => <Link to="/admin/models" search={{ record: id, from: "costs-prices" } as never} />;
const serverLink = (id: string) => <Link to="/admin/mcp-servers" search={{ record: id } as never} />;
const isServer = (r: Item) => r.kind === "mcp_server";
const itemLink = (r: Item) => (isServer(r) ? serverLink(r.modelId) : modelLink(r.modelId));
const kindLabel = (kind: string) => (kind === "mcp_server" ? "MCP server" : (kindLabels[kind as keyof typeof kindLabels] ?? kind));

function columns(currency: string): DataTableColumn<Item>[] {
  return [
    {
      id: "model",
      header: "Model or MCP server",
      accessor: (r) => r.displayName,
      rowHeader: true,
      hideable: false,
      cell: (r) => <CellText primary={<TextLink render={itemLink(r)}>{r.displayName}</TextLink>} secondary={r.modelKey || undefined} />,
    },
    { id: "kind", header: "Kind", accessor: (r) => kindLabel(r.kind), cell: (r) => <Badge tone="info">{kindLabel(r.kind)}</Badge> },
    { id: "prices", header: "Prices today", accessor: (r) => (r.unpriced ? 0 : 1), cell: (r) => <PriceLines current={r.current} currency={currency} /> },
    { id: "status", header: "Status", accessor: (r) => (r.enabled ? "Enabled" : "Disabled"), defaultHidden: true },
  ];
}

export function PricesTab() {
  const list = useQuery(pricesQuery());
  const d = list.data;
  return (
    <ListPage<Item>
      id="admin-cost-prices"
      caption="Prices"
      columns={columns(d?.currency ?? "USD")}
      data={d?.items ?? []}
      getRowId={(r) => r.modelId}
      rowLabel={(r) => r.displayName}
      facets={facets}
      search={{ label: "Search models and MCP servers", placeholder: "Name or key" }}
      loading={list.isLoading}
      error={list.error}
      onRetry={() => void list.refetch()}
      empty={{ icon: <Tags />, title: "No priced models or MCP servers yet." }}
      // On a phone each row stacks, so the prices don't squash into a narrow column (VI-31).
      tableProps={{ stack: true }}
    />
  );
}
