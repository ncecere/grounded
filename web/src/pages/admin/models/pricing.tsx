/*
 * A model's Pricing section on its record page (E2, docs/costs.md §2): the
 * prices today and every dated row. "Change prices" adds rows effective from
 * a date; rows are never edited, and a mistaken one can be deleted. Shown
 * whatever the cost mode, so prices can be entered before tracking starts.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, unwrap, type Schemas } from "@/api/client";
import { FormDialog } from "@/components/form-dialog";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { Field } from "@/components/ui/field/field";
import { Input } from "@/components/ui/input/input";
import { Loading } from "@/components/ui/spinner/spinner";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { toast } from "@/components/ui/toast/toast";
import { amountError, localDay, unitLabels, type PriceUnit } from "@/lib/costs";
import { formatMoney } from "@/lib/format";
import { dayLabel } from "@/components/analytics/format";
import s from "../../shared.module.css";
import c from "../costs/costs.module.css";
import { PriceLines } from "../costs/prices";

type Pricing = Schemas["ModelPricing"];
type PriceRow = Schemas["ModelPrice"];

export const modelPricesQuery = (modelId: string) => ({
  queryKey: ["admin", "costs", "model-prices", modelId],
  queryFn: async () => unwrap(await api.GET("/v1/admin/models/{modelId}/prices", { params: { path: { modelId } } })),
});

/** Whether models of a kind are priced (rerank models aren't). */
export const isPricedKind = (kind: string) => ["chat", "embedding", "systemone", "moderation"].includes(kind);

export function ModelPricingSection({ modelId, isAdmin }: { modelId: string; isAdmin: boolean }) {
  const q = useQuery(modelPricesQuery(modelId));
  const [changing, setChanging] = useState(false);
  const [deleting, setDeleting] = useState<PriceRow | null>(null);
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: async (p: PriceRow) => unwrap(await api.DELETE("/v1/admin/models/{modelId}/prices/{priceId}", { params: { path: { modelId, priceId: p.id } } })),
    onSuccess: () => {
      setDeleting(null);
      toast.success("Price deleted");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["admin", "costs"] }),
  });
  if (q.isLoading) return <Loading label="Loading prices…" />;
  if (!q.data) return <ErrorAlert error={q.error} />;
  const p = q.data;
  return (
    <div className={c.cardBody}>
      <PriceLines current={p.current} currency={p.currency} />
      {isAdmin && (
        <div className={c.actions}>
          <Button size="sm" variant="secondary" onClick={() => setChanging(true)}>
            <Pencil aria-hidden /> Change prices
          </Button>
        </div>
      )}
      {p.history.length === 0 ? (
        <p className={s.muted}>No prices yet: this model's usage counts as zero and is flagged Unpriced.</p>
      ) : (
        <Table caption="Price history" showCaption columns={["Unit", { label: "Price", numeric: true }, "Effective from", "Added by", ...(isAdmin ? [""] : [])]} density="compact">
          {p.history.map((row) => (
            <Tr key={row.id}>
              <Td>{unitLabels[row.unit].label}</Td>
              <Td numeric>
                {formatMoney(row.price, p.currency)} <span className={c.per}>{unitLabels[row.unit].per}</span>
              </Td>
              <Td nowrap>
                <time dateTime={row.effectiveFrom}>{dayLabel(row.effectiveFrom)}</time>
              </Td>
              <Td muted>{row.createdByName || "—"}</Td>
              {isAdmin && (
                <Td>
                  <Button size="sm" variant="ghost" aria-label={`Delete the ${unitLabels[row.unit].label.toLowerCase()} price from ${dayLabel(row.effectiveFrom)}`} onClick={() => setDeleting(row)}>
                    <Trash2 aria-hidden />
                  </Button>
                </Td>
              )}
            </Tr>
          ))}
        </Table>
      )}
      {changing && <ChangePricesDialog pricing={p} onClose={() => setChanging(false)} />}
      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this price?"
        description="Usage on its days is priced at the row before it again (or counts as unpriced). The deletion is recorded in the audit log."
        confirmLabel="Delete price"
        busy={del.isPending}
        error={del.error}
        onConfirm={() => deleting && del.mutate(deleting)}
      />
    </div>
  );
}

function ChangePricesDialog({ pricing, onClose }: { pricing: Pricing; onClose: () => void }) {
  const qc = useQueryClient();
  const [from, setFrom] = useState(localDay());
  const [values, setValues] = useState<Partial<Record<PriceUnit, string>>>({});
  const [submitted, setSubmitted] = useState(false);
  const filled = pricing.units.filter((u) => (values[u] ?? "").trim() !== "");
  const errors = Object.fromEntries(pricing.units.map((u) => [u, amountError(values[u] ?? "", "price", false)]));
  const invalid = filled.length === 0 || !from || pricing.units.some((u) => errors[u]);
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/v1/admin/models/{modelId}/prices", {
          params: { path: { modelId: pricing.modelId } },
          body: { effectiveFrom: from, prices: filled.map((u) => ({ unit: u, price: values[u]!.trim() })) },
        }),
      ),
    onSuccess: (p) => {
      qc.setQueryData(modelPricesQuery(pricing.modelId).queryKey, p);
      qc.invalidateQueries({ queryKey: ["admin", "costs"] });
      toast.success("Prices saved", pricing.displayName);
      onClose();
    },
  });
  return (
    <FormDialog
      title={`Change prices of ${pricing.displayName}`}
      description={`Adds prices from a date, in ${pricing.currency}. Earlier days keep their prices. You may choose a past date to price usage already recorded.`}
      onClose={onClose}
      submitLabel="Save prices"
      busy={save.isPending}
      formProps={{ noValidate: true }}
      onSubmit={() => {
        setSubmitted(true);
        if (!invalid) save.mutate();
      }}
    >
      <div className={c.formGrid}>
        <Field label="Effective from" description="The first day, in the platform time zone." error={submitted && !from ? "Choose a date." : undefined}>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        {pricing.units.map((u) => (
          <Field key={u} label={`${unitLabels[u].label} (${unitLabels[u].per})`} error={submitted ? errors[u] : undefined}>
            <Input inputMode="decimal" placeholder="Unchanged" value={values[u] ?? ""} onChange={(e) => setValues({ ...values, [u]: e.target.value })} />
          </Field>
        ))}
        {submitted && filled.length === 0 && <p className={s.dangerText}>Enter at least one price.</p>}
        <ErrorAlert error={save.error} />
      </div>
    </FormDialog>
  );
}
