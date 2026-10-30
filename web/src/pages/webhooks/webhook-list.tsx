/* The list of webhooks (a team's or the platform's): address, events, status, the secret's last characters and the row menu. */
import { History, KeyRound, Pencil, Trash2, Webhook as WebhookIcon } from "lucide-react";
import { ListPage } from "@/components/templates/list-page";
import { Badge } from "@/components/ui/badge/badge";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import type { Webhook } from "./api";
import { WebhookStatusBadge, pausedReason } from "./status";
import w from "./webhooks.module.css";

/** What a row's menu can do; an action left out is not offered (people who may only read get Deliveries alone). */
export type WebhookActions = {
  onDeliveries: (w: Webhook) => void;
  onEdit?: (w: Webhook) => void;
  onRotate?: (w: Webhook) => void;
  onDelete?: (w: Webhook) => void;
};

/** The secret as the list shows it: only its last four characters, enough to tell secrets apart. */
export const secretText = (w: Pick<Webhook, "secretHint">) => `whsec_…${w.secretHint}`;

const columns: DataTableColumn<Webhook>[] = [
  {
    id: "url",
    header: "Address",
    accessor: "url",
    sortable: true,
    rowHeader: true,
    hideable: false,
    cell: (h) => <CellText primary={<span className={w.url}>{h.url}</span>} secondary={h.description || undefined} />,
  },
  {
    id: "events",
    header: "Events",
    accessor: (h) => h.events.join(" "),
    cell: (h) => (
      <ul className={w.events} aria-label={`Events of ${h.url}`}>
        {h.events.map((e) => (
          <li key={e}>
            <Badge size="sm" variant="outline">
              {e}
            </Badge>
          </li>
        ))}
      </ul>
    ),
  },
  { id: "status", header: "Status", accessor: (h) => (pausedReason(h) ? `paused ${pausedReason(h)}` : h.enabled ? "on" : "off"), sortable: true, cell: (h) => <WebhookStatusBadge webhook={h} /> },
  { id: "secret", header: "Secret", accessor: "secretHint", muted: true, cell: (h) => <code className={w.mono}>{secretText(h)}</code> },
];

type Props = {
  data: Webhook[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  actions: WebhookActions;
  caption: string;
};

export function WebhookList({ data, loading, error, onRetry, actions, caption }: Props) {
  return (
    <ListPage<Webhook>
      id="webhooks"
      caption={caption}
      columns={columns}
      data={data}
      getRowId={(h) => h.id}
      rowLabel={(h) => h.url}
      loading={loading}
      error={error}
      onRetry={onRetry}
      // On a phone each row stacks, so the status (on, off, paused) and the secret are not behind sideways scrolling (#140).
      tableProps={{ stack: true }}
      onRowClick={actions.onDeliveries}
      rowActions={(h) => [
        { label: "Deliveries…", icon: <History aria-hidden />, onSelect: () => actions.onDeliveries(h) },
        { label: "Edit…", icon: <Pencil aria-hidden />, hidden: !actions.onEdit, onSelect: () => actions.onEdit?.(h) },
        { label: "Rotate secret…", icon: <KeyRound aria-hidden />, hidden: !actions.onRotate, onSelect: () => actions.onRotate?.(h) },
        { label: "Delete…", icon: <Trash2 aria-hidden />, danger: true, hidden: !actions.onDelete, onSelect: () => actions.onDelete?.(h) },
      ]}
      empty={{ icon: <WebhookIcon />, title: "No webhooks yet.", description: "A webhook sends signed events to a system of yours as they happen." }}
    />
  );
}
