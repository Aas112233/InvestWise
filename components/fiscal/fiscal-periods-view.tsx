"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, LockKeyhole, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";
import { useFormatDate, useFormatMoney } from "@/lib/use-tenant-settings";
import { usePermissions } from "@/lib/use-permissions";
import { nextFiscalStartYear, resolveFiscalBounds } from "@/lib/fiscal-periods";
import { useFiscalPeriodYears } from "@/lib/fiscal-period-options";
import { AppDropdown, Button, ERPConfirmDialog, ERPDataTable, StatusBadge, type DropdownOption, type ERPColumn } from "@/components/ui";

interface FiscalPeriod {
  id: string;
  tenantId: string;
  year: number;
  fiscalLabel: string;
  periodStart: string;
  periodEnd: string;
  status: string | null;
  totalDeposits: string;
  totalWithdrawals: string;
  totalEarnings: string;
  totalExpenses: string;
  netSurplus: string;
  statutoryReserve: string;
  distributableSurplus: string;
  actualDistributed: string;
  retainedEarnings: string;
  closedAt: string | null;
  notes: string | null;
}

interface FiscalResponse {
  success: boolean;
  data: FiscalPeriod[];
  fiscalYearStart: string;
  fiscalYearEnd: string;
}

type PendingAction = { period: FiscalPeriod; action: "close" | "reopen" } | { action: "start"; year: number };

export function FiscalPeriodsView() {
  const { t } = useLocale();
  const { can } = usePermissions();
  const formatMoney = useFormatMoney();
  const formatDate = useFormatDate();
  const queryClient = useQueryClient();
  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const canWrite = can("FISCAL", "WRITE");

  const { data, isLoading, isError, refetch, isFetching } = useQuery<FiscalResponse>({
    queryKey: ["fiscalPeriods"],
    queryFn: () => apiClient<FiscalResponse>("/fiscal/periods"),
  });

  const periods = data?.data ?? [];
  const startMonth = data?.fiscalYearStart || "July";
  const endMonth = data?.fiscalYearEnd || "June";
  const suggestedYear = nextFiscalStartYear(new Date(), startMonth, periods.map((period) => period.year));

  // Only years that are actually OPEN are offered. The old calendar-derived ±5
  // window let an operator pick a year that already existed (rejected on submit
  // as an overlap) or one that was never created. The list comes from the same
  // tenant-readable endpoint every other picker uses, so starting/closing a year
  // updates it everywhere at once.
  const { years: fiscalYears } = useFiscalPeriodYears();
  const yearOptions: DropdownOption[] = useMemo(
    () =>
      fiscalYears
        .filter((period) => period.status === "OPEN")
        .map((period) => {
          let label = String(period.year);
          try {
            label = resolveFiscalBounds(period.year, startMonth, endMonth).label;
          } catch {
            // The API rejects a malformed tenant configuration before writing.
          }
          return { value: String(period.year), label };
        })
        .sort((a, b) => Number(a.value) - Number(b.value)),
    [fiscalYears, startMonth, endMonth],
  );

  const startMutation = useMutation({
    mutationFn: () => apiClient<{ success: boolean; data: FiscalPeriod }>("/fiscal/periods", {
      method: "POST",
      body: JSON.stringify({ startYear: suggestedYear }),
    }),
    onSuccess: async () => {
      toast.success(t("fiscal.messages.started"));
      setPendingAction(null);
      setSelectedYear(null);
      await queryClient.invalidateQueries({ queryKey: ["fiscalPeriods"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const actionMutation = useMutation({
    mutationFn: ({ periodId, action }: { periodId: string; action: "close" | "reopen" }) =>
      apiClient(`/fiscal/periods/${periodId}`, {
        method: "POST",
        body: JSON.stringify({ action }),
      }),
    onSuccess: async () => {
      toast.success(t(pendingAction?.action === "reopen" ? "fiscal.messages.reopened" : "fiscal.messages.closed"));
      setPendingAction(null);
      await queryClient.invalidateQueries({ queryKey: ["fiscalPeriods"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const columns: ERPColumn<FiscalPeriod>[] = [
    {
      key: "fiscalLabel",
      header: t("fiscal.columns.year"),
      sortable: true,
      render: (period) => (
        <div>
          <span className="font-semibold text-foreground">{t("fiscal.yearLabel", { year: period.fiscalLabel || period.year })}</span>
          <div className="mt-0.5 text-[10px] text-muted-foreground">{period.year}</div>
        </div>
      ),
    },
    {
      key: "periodStart",
      header: t("fiscal.columns.period"),
      render: (period) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDate(period.periodStart)} – {formatDate(period.periodEnd)}
        </span>
      ),
    },
    {
      key: "status",
      header: t("fiscal.columns.status"),
      render: (period) => (
        <StatusBadge tone={period.status === "CLOSED" ? "slate" : "emerald"}>
          {period.status === "CLOSED" ? t("fiscal.status.closed") : t("fiscal.status.open")}
        </StatusBadge>
      ),
    },
    {
      key: "totalEarnings",
      header: t("fiscal.columns.earnings"),
      align: "right",
      render: (period) => <span className="font-mono text-xs">{formatMoney(period.totalEarnings)}</span>,
    },
    {
      key: "totalExpenses",
      header: t("fiscal.columns.expenses"),
      align: "right",
      render: (period) => <span className="font-mono text-xs">{formatMoney(period.totalExpenses)}</span>,
    },
    {
      key: "statutoryReserve",
      header: t("fiscal.columns.reserve"),
      align: "right",
      render: (period) => <span className="font-mono text-xs">{formatMoney(period.statutoryReserve)}</span>,
    },
    {
      key: "distributableSurplus",
      header: t("fiscal.columns.distributable"),
      align: "right",
      render: (period) => <span className="font-mono text-xs font-semibold">{formatMoney(period.distributableSurplus)}</span>,
    },
    {
      key: "actions",
      header: t("fiscal.columns.actions"),
      align: "right",
      render: (period) => {
        if (!canWrite) return <span className="text-xs text-muted-foreground">—</span>;
        const closed = period.status === "CLOSED";
        return (
          <Button
            variant="outline"
            size="xs"
            onClick={() => setPendingAction({ period, action: closed ? "reopen" : "close" })}
            disabled={actionMutation.isPending}
          >
            {closed ? <RotateCcw /> : <LockKeyhole />}
            {closed ? t("fiscal.actions.reopen") : t("fiscal.actions.close")}
          </Button>
        );
      },
    },
  ];

  const dialogTitle = pendingAction?.action === "start"
    ? t("fiscal.confirm.startTitle")
    : pendingAction?.action === "close"
      ? t("fiscal.confirm.closeTitle")
      : t("fiscal.confirm.reopenTitle");
  const dialogDescription = pendingAction?.action === "start"
    ? t("fiscal.confirm.startDescription", { year: pendingAction.year })
    : pendingAction?.action === "close"
      ? t("fiscal.confirm.closeDescription")
      : t("fiscal.confirm.reopenDescription");
  const dialogPending = pendingAction?.action === "start" ? startMutation.isPending : actionMutation.isPending;

  const confirmAction = async () => {
    if (!pendingAction) return;
    if (pendingAction.action === "start") {
      await startMutation.mutateAsync();
      return;
    }
    await actionMutation.mutateAsync({ periodId: pendingAction.period.id, action: pendingAction.action });
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{t("fiscal.title")}</h1>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("fiscal.subtitle", { start: startMonth, end: endMonth })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RotateCcw className={isFetching ? "animate-spin" : ""} />
            {t("common.update")}
          </Button>
          {canWrite && (
            <>
              <div className="w-36">
                <AppDropdown
                  options={yearOptions}
                  value={selectedYear ?? (yearOptions[0]?.value ?? "")}
                  onChange={setSelectedYear}
                  clearable={false}
                  placeholder={t("fiscal.actions.selectYear")}
                />
              </div>
              <Button variant="primary" size="sm" onClick={() => setPendingAction({ action: "start", year: suggestedYear })}>
                <Plus />
                {t("fiscal.actions.startYear")}
              </Button>
            </>
          )}
        </div>
      </header>

      {isError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive" role="alert">
          <p>{t("fiscal.errors.load")}</p>
          <Button className="mt-3" variant="outline" size="sm" onClick={() => void refetch()}>{t("common.retry")}</Button>
        </div>
      ) : (
        <ERPDataTable
          data={periods}
          columns={columns}
          loading={isLoading}
          rowKey={(period) => period.id}
          emptyMessage={t("fiscal.empty")}
        />
      )}

      <div className="rounded-lg border border-border/80 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{t("fiscal.onboarding.title")}</span>
        <span className="ml-2">{t("fiscal.onboarding.description")}</span>
      </div>

      <ERPConfirmDialog
        open={Boolean(pendingAction)}
        title={dialogTitle}
        description={dialogDescription}
        confirmLabel={pendingAction?.action === "start" ? t("fiscal.actions.startYear") : pendingAction?.action === "close" ? t("fiscal.actions.close") : t("fiscal.actions.reopen")}
        cancelLabel={t("common.cancel")}
        confirmVariant="primary"
        pending={dialogPending}
        pendingLabel={t("common.loading")}
        onConfirm={confirmAction}
        onClose={() => setPendingAction(null)}
      />
    </div>
  );
}
