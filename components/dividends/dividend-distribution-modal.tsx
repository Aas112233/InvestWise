"use client";

import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  TopSheet,
  ERPFormLayout,
  ERPFormSection,
  ERPFormGrid,
  ERPFormField,
  AppDropdown,
  DropdownOption,
  Button,
} from "@/components/ui";
import { apiClient } from "@/lib/api-client";
import { toast } from "sonner";
import { useLocale } from "@/lib/i18n";
import { formatMoney } from "@/lib/formatters";
import { Calculator, CheckCircle2, Loader2 } from "lucide-react";

interface FundOption {
  id: string;
  name: string;
  type: string;
  balance: string;
}

interface MemberAllocation {
  id: string;
  memberId: string;
  name: string;
  shares: number;
  grossAmount: string;
}

interface CalculationResult {
  grossEarnings: string;
  statutoryReservePercent: string;
  statutoryReserveAmount: string;
  netDistributable: string;
  totalActiveShares: number;
  ratePerShare: string;
  memberAllocations: MemberAllocation[];
}

interface DividendDistributionModalProps {
  isOpen: boolean;
  onClose: () => void;
  currency?: string;
}

export function DividendDistributionModal({
  isOpen,
  onClose,
  currency = "BDT",
}: DividendDistributionModalProps) {
  const { t } = useLocale();
  const queryClient = useQueryClient();

  const [distributableFundId, setDistributableFundId] = useState("");
  const [reserveFundId, setReserveFundId] = useState("");
  const [grossEarnings, setGrossEarnings] = useState("");
  const [statutoryReservePercent, setStatutoryReservePercent] = useState("10");
  const [calculation, setCalculation] = useState<CalculationResult | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  // Fetch available funds
  const { data: fundsData } = useQuery<{ data: FundOption[] }>({
    queryKey: ["funds", "options"],
    queryFn: async () => {
      try {
        return await apiClient("/funds?limit=100");
      } catch {
        return { data: [] };
      }
    },
    enabled: isOpen,
  });

  const fundsList = fundsData?.data || [];

  const distributableFundOptions: DropdownOption[] = fundsList.map((f) => ({
    value: f.id,
    label: `${f.name} (Bal: ${formatMoney(f.balance, currency)})`,
  }));

  const reserveFundOptions: DropdownOption[] = fundsList.map((f) => ({
    value: f.id,
    label: `${f.name} [${f.type}]`,
  }));

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setDistributableFundId("");
      setReserveFundId("");
      setGrossEarnings("");
      setStatutoryReservePercent("10");
      setCalculation(null);
    }
  }, [isOpen]);

  const handleSimulate = async () => {
    if (!distributableFundId) {
      toast.error(t("dividends.selectFundError"));
      return;
    }
    const grossNum = parseFloat(grossEarnings);
    if (!grossNum || grossNum <= 0) {
      toast.error(t("dividends.invalidAmount"));
      return;
    }

    setIsCalculating(true);
    try {
      const res = await apiClient<{ success: boolean; data: CalculationResult }>(
        "/dividends/calculate",
        {
          method: "POST",
          body: JSON.stringify({
            grossEarnings: grossNum,
            distributableFundId,
            reserveFundId: reserveFundId || undefined,
            statutoryReservePercent: parseFloat(statutoryReservePercent) || 10,
          }),
        }
      );
      if (res.success && res.data) {
        setCalculation(res.data);
      }
    } catch (err: any) {
      toast.error(err?.message || "Simulation failed");
      setCalculation(null);
    } finally {
      setIsCalculating(false);
    }
  };

  const distributeMutation = useMutation({
    mutationFn: async () => {
      const grossNum = parseFloat(grossEarnings);
      return await apiClient("/dividends/distribute", {
        method: "POST",
        body: JSON.stringify({
          grossEarnings: grossNum,
          distributableFundId,
          reserveFundId: reserveFundId || undefined,
          statutoryReservePercent: parseFloat(statutoryReservePercent) || 10,
        }),
      });
    },
    onSuccess: () => {
      toast.success(
        t("dividends.distSuccess") || "Dividends distributed successfully."
      );
      queryClient.invalidateQueries({ queryKey: ["dividends"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["funds"] });
      queryClient.invalidateQueries({ queryKey: ["members"] });
      onClose();
    },
    onError: (err: any) => {
      toast.error(err?.message || t("dividends.distError"));
    },
  });

  return (
    <TopSheet
      isOpen={isOpen}
      onClose={onClose}
      title={t("dividends.payoutConfig")}
      subtitle={t("dividends.configSub")}
      wide={true}
      footer={
        <div className="flex items-center justify-between w-full">
          <Button variant="ghost" onClick={onClose} disabled={distributeMutation.isPending}>
            {t("common.cancel")}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={handleSimulate}
              disabled={isCalculating || !distributableFundId || !grossEarnings}
            >
              {isCalculating ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Calculator className="w-4 h-4 mr-1.5" />
              )}
              {t("common.preview")}
            </Button>
            <Button
              variant="primary"
              onClick={() => distributeMutation.mutate()}
              disabled={
                distributeMutation.isPending ||
                !calculation ||
                !distributableFundId ||
                !grossEarnings
              }
            >
              {distributeMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4 mr-1.5" />
              )}
              {t("dividends.authorize")}
            </Button>
          </div>
        </div>
      }
    >
      <ERPFormLayout>
        <ERPFormSection
          title={t("dividends.distType")}
          description={t("dividends.configSub")}
        >
          <ERPFormGrid cols={2}>
            <ERPFormField label={t("dividends.selectSourceFund")} required>
              <AppDropdown
                options={distributableFundOptions}
                value={distributableFundId}
                onChange={(val) => {
                  setDistributableFundId(val || "");
                  setCalculation(null);
                }}
                placeholder={t("dividends.selectPrimaryFund")}
              />
            </ERPFormField>

            <ERPFormField label="Statutory Reserve Fund (Retained Earnings)">
              <AppDropdown
                options={reserveFundOptions}
                value={reserveFundId}
                onChange={(val) => {
                  setReserveFundId(val || "");
                  setCalculation(null);
                }}
                placeholder={t("dividends.selectReserveFundPlaceholder", { defaultValue: "Select reserve fund..." })}
              />
            </ERPFormField>
          </ERPFormGrid>

          <ERPFormGrid cols={2}>
            <ERPFormField label={t("dividends.payoutAmount")} required>
              <input
                type="number"
                step="0.01"
                min="0.01"
                className="w-full px-3 py-2 text-sm bg-card border border-border/80 rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                placeholder="0.00"
                value={grossEarnings}
                onChange={(e) => {
                  setGrossEarnings(e.target.value);
                  setCalculation(null);
                }}
              />
            </ERPFormField>

            <ERPFormField label="Statutory Reserve Buffer (%)" hint="Default 10% statutory retention">
              <input
                type="number"
                step="1"
                min="0"
                max="100"
                className="w-full px-3 py-2 text-sm bg-card border border-border/80 rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                value={statutoryReservePercent}
                onChange={(e) => {
                  setStatutoryReservePercent(e.target.value);
                  setCalculation(null);
                }}
              />
            </ERPFormField>
          </ERPFormGrid>
        </ERPFormSection>

        {calculation && (
          <ERPFormSection
            title={t("dividends.payoutPreview")}
            description={t("dividends.logicDesc")}
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 bg-muted/30 rounded-lg border border-border/80 text-xs">
              <div>
                <span className="text-slate-500 dark:text-slate-400 block mb-0.5">Gross Surplus</span>
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {formatMoney(calculation.grossEarnings, currency)}
                </span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block mb-0.5">
                  Statutory Reserve ({calculation.statutoryReservePercent}%)
                </span>
                <span className="font-semibold text-amber-600 dark:text-amber-400">
                  {formatMoney(calculation.statutoryReserveAmount, currency)}
                </span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block mb-0.5">Net Distributable</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {formatMoney(calculation.netDistributable, currency)}
                </span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block mb-0.5">
                  Rate / Share ({calculation.totalActiveShares} sh)
                </span>
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {formatMoney(calculation.ratePerShare, currency)} / sh
                </span>
              </div>
            </div>

            <div className="mt-3">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-2">
                Member Allocation Preview ({calculation.memberAllocations.length} recipients)
              </span>
              <div className="max-h-60 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-md">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 dark:bg-slate-800 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">Member</th>
                      <th className="px-3 py-2 text-center font-medium text-slate-600 dark:text-slate-400">Shares</th>
                      <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-400">Dividend Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {calculation.memberAllocations.map((alloc) => (
                      <tr key={alloc.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                        <td className="px-3 py-2 text-slate-900 dark:text-slate-100 font-medium">
                          {alloc.name} <span className="text-slate-400 font-mono">({alloc.memberId})</span>
                        </td>
                        <td className="px-3 py-2 text-center text-slate-700 dark:text-slate-300">
                          {alloc.shares}
                        </td>
                        <td className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-400 font-semibold">
                          {formatMoney(alloc.grossAmount, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </ERPFormSection>
        )}
      </ERPFormLayout>
    </TopSheet>
  );
}
