"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Download, FileSpreadsheet, Loader2, Search, TriangleAlert, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { FiscalMonthValue } from "@/components/ui/erp-fiscal-month-picker";
import { ERPFormSection } from "@/components/ui/erp-form-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { ApiError, apiClient } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import {
  MAX_DEPOSIT_AMOUNT,
  MAX_TEMPLATE_ROWS,
  TemplateError,
  XLSX_MIME,
  buildDepositTemplate,
  readDepositTemplate,
  reviewDepositImport,
  type FieldName,
  type FlagReason,
  type ImportReview,
} from "@/lib/deposit-excel";
import { formatMoney } from "@/lib/formatters";
import { useLocale } from "@/lib/i18n";
import { fromCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { DEPOSIT_MONTH_KEYS, useFundOptions, useMemberOptions, useTenantCurrency, type DepositRow } from "./shared";
import { DEPOSIT_FUND_TYPE } from "@/lib/deposit-fund";

const FIELD_LABEL_KEY: Record<FieldName, string> = {
  memberId: "deposits.excel.template.memberId",
  name: "deposits.excel.template.name",
  shares: "deposits.excel.template.shares",
};

const clamp = (text: string, max = 60) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// Mirrors the server's duplicate rule: a Completed deposit for this member, fund and month.
async function fetchPaidMemberIds(fundId: string, monthKey: string): Promise<Set<string>> {
  const res = await apiClient<{ data: DepositRow[] }>("/deposits", {
    params: { page: 1, limit: 500, fundId, depositMonth: monthKey, status: "Completed" },
  });
  return new Set((res.data ?? []).flatMap((d) => (d.memberId ? [d.memberId] : [])));
}

interface PendingImport {
  fileName: string;
  review: ImportReview;
}

export function BulkExcelImport({
  fundId,
  month,
  method,
  shareValueCents,
  selected,
  onSelectedChange,
  onSubmitted,
}: {
  fundId: string | null;
  month: FiscalMonthValue;
  method: string | null;
  shareValueCents: number | null;
  selected: ReadonlySet<string>;
  onSelectedChange: (next: Set<string>) => void;
  onSubmitted: () => void;
}) {
  const { t, locale } = useLocale();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const currency = useTenantCurrency();
  const membersQuery = useMemberOptions();
  const fundsQuery = useFundOptions(DEPOSIT_FUND_TYPE);
  const fileRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const [search, setSearch] = useState("");
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // The picker's month value is the absolute YYYY-MM of the fiscal month the
  // user chose, so it is both the template period and the wire period.
  const monthKey = month.month;
  const canUpload = !!fundId && !!monthKey && !reading;
  const tenantId = user?.tenantId ?? null;

  const active = useMemo(() => (membersQuery.data ?? []).filter((m) => m.status === "active"), [membersQuery.data]);
  const query = search.trim().toLowerCase();
  const visible = query
    ? active.filter((m) => m.name.toLowerCase().includes(query) || m.memberId.toLowerCase().includes(query))
    : active;
  const chosen = active.filter((m) => selected.has(m.id));

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange(next);
  };

  const download = async () => {
    try {
      const data = await buildDepositTemplate({
        members: chosen.map((m) => ({ id: m.id, memberId: m.memberId, name: m.name, shares: m.shares ?? 0 })),
        shareValueCents,
        tenantId,
        rtl: locale === "ur",
        labels: {
          sheetName: t("deposits.excel.template.sheetName"),
          instructionsSheetName: t("deposits.excel.template.instructionsSheet"),
          memberId: t("deposits.excel.template.memberId"),
          name: t("deposits.excel.template.name"),
          shares: t("deposits.excel.template.shares"),
          amount: t("deposits.excel.template.amount", { currency }),
          instructionsTitle: t("deposits.excel.template.instructionsTitle"),
          instructions: [
            t("deposits.excel.template.instruction1"),
            t("deposits.excel.template.instruction2"),
            t("deposits.excel.template.instruction3"),
          ],
          amountErrorTitle: t("deposits.excel.template.amountErrorTitle"),
          amountError: t("deposits.excel.template.amountError", { max: MAX_DEPOSIT_AMOUNT.toLocaleString("en-US") }),
        },
      });
      const url = URL.createObjectURL(new Blob([data], { type: XLSX_MIME }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `bulk-deposit-template-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("[BULK_EXCEL] template build failed", error);
      toast.error(t("deposits.excel.downloadFailed"));
    }
  };

  const processFile = async (file: File) => {
    if (!fundId || !monthKey) return;
    setFileError(null);
    const members = membersQuery.data;
    if (!members) {
      setFileError(t("deposits.excel.errors.membersUnavailable"));
      return;
    }
    setReading(true);
    try {
      const data = await readDepositTemplate(file);
      const paid = await queryClient.fetchQuery({
        queryKey: ["deposits", "paid-members", { fundId, monthKey }],
        queryFn: () => fetchPaidMemberIds(fundId, monthKey),
        staleTime: 0,
      });
      setPending({ fileName: file.name, review: reviewDepositImport(data, { tenantId, members, alreadyPaid: paid }) });
    } catch (error) {
      if (!(error instanceof TemplateError) && !(error instanceof ApiError)) {
        console.error("[BULK_EXCEL] import failed", error);
      }
      setFileError(
        error instanceof TemplateError
          ? t(`deposits.excel.errors.${error.code}`, { max: MAX_TEMPLATE_ROWS, size: "1 MB" })
          : error instanceof ApiError
            ? error.message
            : t("deposits.excel.errors.unreadable"),
      );
    } finally {
      setReading(false);
    }
  };

  const submit = async () => {
    if (!pending || !fundId || !monthKey) return;
    const { ready } = pending.review;
    const deposits = ready.map((r) => ({
      memberId: r.key,
      amount: Number(fromCents(r.amountCents)),
      depositMonth: monthKey,
      date: `${monthKey}-01`,
    }));
    const fingerprint = JSON.stringify({ fundId, monthKey, method, deposits });
    if (requestRef.current?.fingerprint !== fingerprint) {
      requestRef.current = { fingerprint, key: crypto.randomUUID() };
    }

    setSubmitting(true);
    try {
      await apiClient("/finance/deposits/bulk", {
        method: "POST",
        body: JSON.stringify({
          fundId,
          requestKey: requestRef.current.key,
          commonMonth: monthKey,
          depositMethod: method || undefined,
          deposits,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ["deposits"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
      toast.success(t("deposits.bulk.successToast", { count: ready.length }));
      setPending(null);
      onSubmitted();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("deposits.loadFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const fundName = fundsQuery.data?.find((f) => f.id === fundId)?.name ?? "—";
  const monthKeyParts = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(monthKey ?? "");
  const monthLabel = monthKeyParts
    ? `${t(`common.months.${DEPOSIT_MONTH_KEYS[Number(monthKeyParts[2]) - 1] ?? "jan"}`)} ${monthKeyParts[1]}`
    : "—";

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <ERPFormSection title={t("deposits.excel.downloadTitle")} description={t("deposits.excel.downloadHint")}>
          <div className="relative">
            <Search size={13} className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("deposits.excel.searchMembers")}
              aria-label={t("deposits.excel.searchMembers")}
              className="w-full ps-8 pe-3 py-2 rounded-lg border text-xs bg-card border-border/80 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="xs"
                disabled={visible.length === 0}
                onClick={() => onSelectedChange(new Set([...selected, ...visible.map((m) => m.id)]))}
              >
                {t("deposits.excel.selectAll")}
              </Button>
              <Button variant="ghost" size="xs" disabled={selected.size === 0} onClick={() => onSelectedChange(new Set())}>
                {t("deposits.excel.clearSelection")}
              </Button>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {t("deposits.excel.selectedCount", { count: chosen.length })}
            </span>
          </div>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-border/80 divide-y divide-border/60">
            {membersQuery.isLoading ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} height="1.75rem" />
                ))}
              </div>
            ) : membersQuery.isError ? (
              <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
                <p className="text-xs text-destructive">{t("deposits.excel.errors.membersUnavailable")}</p>
                <Button variant="outline" size="xs" onClick={() => membersQuery.refetch()}>
                  {t("common.retry")}
                </Button>
              </div>
            ) : visible.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">{t("deposits.excel.noMembers")}</p>
            ) : (
              visible.map((m) => (
                <label
                  key={m.id}
                  className="flex cursor-pointer items-center gap-3 px-3 py-2 text-xs hover:bg-muted/40 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(m.id)}
                    onChange={() => toggle(m.id)}
                    className="h-3.5 w-3.5 shrink-0 accent-primary"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground">{m.name}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {t("deposits.excel.memberCaption", { memberId: m.memberId, shares: m.shares ?? 0 })}
                    </span>
                  </span>
                </label>
              ))
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            icon={<Download size={13} />}
            disabled={chosen.length === 0}
            loadingLabel={t("deposits.excel.preparing")}
            onClick={download}
          >
            {t("deposits.excel.download", { count: chosen.length })}
          </Button>
        </ERPFormSection>

        <ERPFormSection title={t("deposits.excel.uploadTitle")} description={t("deposits.excel.uploadHint")}>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = canUpload ? "copy" : "none";
              if (canUpload) setDragging(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file && canUpload) void processFile(file);
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-2.5 rounded-lg border border-dashed px-4 py-10 text-center transition-colors",
              dragging ? "border-primary bg-primary/5" : "border-border/80 bg-muted/20",
            )}
          >
            {reading ? (
              <>
                <Loader2 size={20} className="animate-spin text-primary" />
                <p className="text-xs text-muted-foreground">{t("deposits.excel.reading")}</p>
              </>
            ) : (
              <>
                <FileSpreadsheet size={24} className="text-muted-foreground" />
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Upload size={13} />}
                  disabled={!canUpload}
                  onClick={() => fileRef.current?.click()}
                >
                  {t("deposits.excel.chooseFile")}
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  {canUpload ? t("deposits.excel.dropHint") : t("deposits.excel.selectFundMonthFirst")}
                </p>
              </>
            )}
            <input
              ref={fileRef}
              type="file"
              accept={`.xlsx,${XLSX_MIME}`}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void processFile(file);
              }}
            />
          </div>
          {fileError && (
            <p role="alert" className="flex items-start gap-1.5 text-[11px] font-medium text-destructive">
              <TriangleAlert size={12} className="mt-0.5 shrink-0" />
              <span>{fileError}</span>
            </p>
          )}
        </ERPFormSection>
      </div>

      {pending && (
        <ImportConfirmModal
          pending={pending}
          summary={[
            [t("deposits.bulk.fund"), fundName],
            [t("deposits.bulk.month"), monthLabel],
            [t("deposits.bulk.method"), method || "—"],
            [t("deposits.excel.confirm.file"), pending.fileName],
          ]}
          currency={currency}
          submitting={submitting}
          onSubmit={submit}
          onClose={() => setPending(null)}
        />
      )}
    </>
  );
}

function ImportConfirmModal({
  pending,
  summary,
  currency,
  submitting,
  onSubmit,
  onClose,
}: {
  pending: PendingImport;
  summary: [string, string][];
  currency: string;
  submitting: boolean;
  onSubmit: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const backdropPointerDown = useRef(false);
  const { ready, flagged, skipped, totalCents } = pending.review;
  const money = (cents: number) => formatMoney(fromCents(cents), currency);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Capture phase, so the bulk sheet underneath never sees this Escape.
      e.stopPropagation();
      if (!submitting) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [submitting, onClose]);

  const describe = (reason: FlagReason) =>
    reason.code === "changed"
      ? {
          head: t("deposits.excel.reasons.changed"),
          details: reason.fields.map((f) =>
            t("deposits.excel.reasons.fieldChange", {
              field: t(FIELD_LABEL_KEY[f.field]),
              from: clamp(f.from) || "—",
              to: clamp(f.to) || "—",
            }),
          ),
        }
      : { head: t(`deposits.excel.reasons.${reason.code}`), details: [] };

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto p-4 sm:p-6">
      <div
        className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm animate-in fade-in-50"
        aria-hidden="true"
        onPointerDown={(e) => {
          backdropPointerDown.current = e.button === 0 && e.target === e.currentTarget;
        }}
        onClick={(e) => {
          const startedOnBackdrop = backdropPointerDown.current;
          backdropPointerDown.current = false;
          if (startedOnBackdrop && e.target === e.currentTarget && !submitting) onClose();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="excel-import-title"
        className="relative z-[111] my-auto w-full max-w-3xl overflow-hidden rounded-xl border border-border/80 dark:border-white/10 bg-card text-card-foreground shadow-2xl animate-in fade-in-50 zoom-in-95 duration-150"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border/80 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="shrink-0 rounded-lg bg-primary/10 p-2 text-primary">
              <FileSpreadsheet size={16} />
            </div>
            <div className="space-y-0.5">
              <h2 id="excel-import-title" className="text-base font-bold tracking-tight text-foreground">
                {t("deposits.excel.confirm.title")}
              </h2>
              <p className="text-xs text-muted-foreground">{t("deposits.excel.confirm.subtitle")}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label={t("common.close")}
            className="p-1.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto px-6 py-5">
          <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border/80 bg-muted/20 p-3 sm:grid-cols-4">
            {summary.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</dt>
                <dd className="truncate text-xs font-medium text-foreground" title={value}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="emerald">{t("deposits.excel.confirm.ready", { count: ready.length })}</StatusBadge>
            {flagged.length > 0 && (
              <StatusBadge tone="rose">{t("deposits.excel.confirm.flagged", { count: flagged.length })}</StatusBadge>
            )}
            {skipped > 0 && (
              <StatusBadge tone="slate">{t("deposits.excel.confirm.skipped", { count: skipped })}</StatusBadge>
            )}
          </div>

          {flagged.length > 0 && (
            <section className="overflow-hidden rounded-lg border border-destructive/30">
              <div className="flex items-start gap-2 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
                <TriangleAlert size={14} className="mt-0.5 shrink-0" />
                <p className="font-medium">{t("deposits.excel.confirm.flaggedNote")}</p>
              </div>
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr className="border-t border-border/60">
                    <th className="w-16 px-3 py-2 text-start font-semibold">{t("deposits.excel.confirm.row")}</th>
                    <th className="px-3 py-2 text-start font-semibold">{t("deposits.bulk.member")}</th>
                    <th className="px-3 py-2 text-start font-semibold">{t("deposits.excel.confirm.issue")}</th>
                  </tr>
                </thead>
                <tbody>
                  {flagged.map((f) => (
                    <tr key={f.row} className="border-t border-border/60 align-top">
                      <td className="px-3 py-2 font-mono text-muted-foreground">{f.row}</td>
                      <td className="px-3 py-2">
                        <span className="block font-medium text-foreground">{clamp(f.name) || "—"}</span>
                        <span className="block text-[11px] text-muted-foreground">{clamp(f.memberId) || "—"}</span>
                      </td>
                      <td className="px-3 py-2">
                        <ul className="space-y-1">
                          {f.reasons.map((reason, i) => {
                            const { head, details } = describe(reason);
                            return (
                              <li key={i}>
                                <span className="font-medium text-destructive">{head}</span>
                                {details.map((line) => (
                                  <span key={line} className="block text-[11px] text-muted-foreground">
                                    {line}
                                  </span>
                                ))}
                              </li>
                            );
                          })}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section className="overflow-hidden rounded-lg border border-border/80">
            <h3 className="bg-muted/30 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-foreground">
              {t("deposits.excel.confirm.readyTitle")}
            </h3>
            {ready.length === 0 ? (
              <p className="border-t border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
                {t("deposits.excel.confirm.noReady")}
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr className="border-t border-border/60">
                    <th className="px-3 py-2 text-start font-semibold">{t("deposits.excel.template.memberId")}</th>
                    <th className="px-3 py-2 text-start font-semibold">{t("deposits.excel.template.name")}</th>
                    <th className="px-3 py-2 text-end font-semibold">{t("deposits.bulk.shares")}</th>
                    <th className="px-3 py-2 text-end font-semibold">{t("deposits.bulk.amount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {ready.map((r) => (
                    <tr key={r.key} className="border-t border-border/60">
                      <td className="px-3 py-2 font-mono text-muted-foreground">{r.memberId}</td>
                      <td className="px-3 py-2 font-medium text-foreground">{r.name}</td>
                      <td className="px-3 py-2 text-end font-mono">{r.shares}</td>
                      <td className="px-3 py-2 text-end font-mono font-semibold text-foreground">
                        {money(r.amountCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border/80 bg-muted/20">
                    <td
                      colSpan={3}
                      className="px-3 py-2 text-end text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      {t("deposits.excel.confirm.total")}
                    </td>
                    <td className="px-3 py-2 text-end font-mono font-bold text-foreground">{money(totalCents)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/80 px-6 py-4">
          <Button variant="outline" size="sm" onClick={onClose} disabled={submitting} autoFocus>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={ready.length === 0}
            loading={submitting}
            loadingLabel={t("deposits.bulk.submitting")}
            onClick={onSubmit}
          >
            {t("deposits.bulk.submit", { count: ready.length })}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
