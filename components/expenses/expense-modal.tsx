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
import { Plus, Loader2 } from "lucide-react";

interface FundOption {
  id: string;
  name: string;
  type: string;
  balance: string;
}

interface MemberOption {
  id: string;
  name: string;
  memberId: string;
}

interface UserOption {
  id: string;
  name: string;
  role: string;
}

interface ExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  currency?: string;
}

export function ExpenseModal({ isOpen, onClose, currency = "BDT" }: ExpenseModalProps) {
  const { t } = useLocale();
  const queryClient = useQueryClient();

  const [category, setCategory] = useState("");
  const [expenseName, setExpenseName] = useState("");
  const [memberId, setMemberId] = useState("");
  const [approvedBy, setApprovedBy] = useState("");
  const [fundId, setFundId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");

  useEffect(() => {
    if (isOpen) {
      setDate(new Date().toISOString().slice(0, 10));
    } else {
      setCategory("");
      setExpenseName("");
      setMemberId("");
      setApprovedBy("");
      setFundId("");
      setAmount("");
      setDate("");
      setDescription("");
      setReferenceNumber("");
    }
  }, [isOpen]);

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

  // Expense-by member list (§15: no preselection — starts empty).
  const { data: membersData } = useQuery<{ data: MemberOption[] }>({
    queryKey: ["members", "options"],
    queryFn: async () => {
      try {
        const res = await apiClient<{ data: MemberOption[] } | MemberOption[]>("/members?limit=500");
        return Array.isArray(res) ? { data: res } : { data: res?.data || [] };
      } catch {
        return { data: [] };
      }
    },
    enabled: isOpen,
  });

  // Approver directory (Admin/Manager only). If the caller cannot list users,
  // the field stays empty and the API records the submitter as approver.
  const { data: usersData } = useQuery<UserOption[]>({
    queryKey: ["users", "options"],
    queryFn: async () => {
      try {
        const res = await apiClient<UserOption[] | { data: UserOption[] }>("/auth/users");
        return Array.isArray(res) ? res : res?.data || [];
      } catch {
        return [];
      }
    },
    enabled: isOpen,
  });

  const fundsList = fundsData?.data || [];
  const membersList = membersData?.data || [];
  const usersList = usersData || [];

  const fundOptions: DropdownOption[] = fundsList.map((f) => ({
    value: f.id,
    label: `${f.name} (Bal: ${formatMoney(f.balance, currency)})`,
  }));

  const memberOptions: DropdownOption[] = membersList.map((m) => ({
    value: m.id,
    label: m.memberId ? `${m.memberId} — ${m.name}` : m.name,
  }));

  const approverOptions: DropdownOption[] = usersList
    .filter((u) => (u.role || "").toLowerCase() !== "member")
    .map((u) => ({
      value: u.id,
      label: u.role ? `${u.name} (${u.role})` : u.name,
    }));

  const categoryOptions: DropdownOption[] = [
    { value: "Operational", label: t("expenses.categories.operational") },
    { value: "Marketing", label: t("expenses.categories.marketing") },
    { value: "Legal", label: t("expenses.categories.legal") },
    { value: "Travel", label: t("expenses.categories.travel") },
    { value: "Technology", label: t("expenses.categories.technology") },
    { value: "Maintenance", label: t("expenses.categories.maintenance") },
    { value: "Other", label: "Other" },
  ];

  const createExpenseMutation = useMutation({
    mutationFn: async () => {
      const amountNum = parseFloat(amount);
      if (!amountNum || amountNum <= 0) {
        throw new Error(t("expenses.validAmount"));
      }
      if (!fundId) {
        throw new Error("Source fund is required");
      }
      if (!category) {
        throw new Error("Category is required");
      }
      if (!expenseName.trim()) {
        throw new Error(t("expenses.nameRequired", { defaultValue: "Expense name is required" }));
      }
      if (!memberId) {
        throw new Error(t("expenses.memberRequired", { defaultValue: "Expense by member is required" }));
      }
      if (!description.trim()) {
        throw new Error("Description is required");
      }

      return await apiClient("/expenses", {
        method: "POST",
        body: JSON.stringify({
          category,
          expenseName: expenseName.trim(),
          memberId,
          approvedBy: approvedBy || undefined,
          fundId,
          amount: amountNum,
          date: date || new Date().toISOString(),
          description: description.trim(),
          referenceNumber: referenceNumber.trim() || undefined,
        }),
      });
    },
    onSuccess: () => {
      toast.success(
        t("expenses.confirmSuccess", { amount: formatMoney(amount, currency) }) ||
          "Expense recorded successfully."
      );
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["funds"] });
      onClose();
    },
    onError: (err: any) => {
      toast.error(err?.message || t("common.errors.failedToRecordExpense", { defaultValue: "Failed to record expense" }));
    },
  });

  return (
    <TopSheet
      isOpen={isOpen}
      onClose={onClose}
      title={t("expenses.strategicAllocation")}
      subtitle={t("expenses.recordOutflow")}
      wide={true}
      footer={
        <div className="flex items-center justify-between w-full">
          <Button variant="ghost" onClick={onClose} disabled={createExpenseMutation.isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => createExpenseMutation.mutate()}
            disabled={
              createExpenseMutation.isPending ||
              !amount ||
              !fundId ||
              !category ||
              !expenseName.trim() ||
              !memberId ||
              !description
            }
          >
            {createExpenseMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <Plus className="w-4 h-4 mr-1.5" />
            )}
            {t("expenses.postExpense")}
          </Button>
        </div>
      }
    >
      <ERPFormLayout>
        <ERPFormSection
          title="Expense Details"
          description="Name the expense, state the justification, and pick the member, approver, and source fund"
        >
          <ERPFormGrid cols={2}>
            <ERPFormField label={t("expenses.expenseName", { defaultValue: "Expense Name" })} required>
              <input
                type="text"
                className="w-full px-3 py-2 text-xs bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
                placeholder={t("expenses.namePlaceholder", { defaultValue: "e.g. Office rent — March" })}
                value={expenseName}
                onChange={(e) => setExpenseName(e.target.value)}
                maxLength={255}
              />
            </ERPFormField>

            <ERPFormField label={t("expenses.category")} required>
              <AppDropdown
                options={categoryOptions}
                value={category}
                onChange={(val) => setCategory(val || "")}
                placeholder={t("expenses.selectCategoryPlaceholder", { defaultValue: "Select category..." })}
              />
            </ERPFormField>
          </ERPFormGrid>

          <ERPFormGrid cols={2}>
            <ERPFormField label={t("expenses.expenseBy", { defaultValue: "Expense By (member)" })} required>
              <AppDropdown
                options={memberOptions}
                value={memberId}
                onChange={(val) => setMemberId(val || "")}
                placeholder={t("expenses.selectMemberPlaceholder", { defaultValue: "Select member..." })}
              />
            </ERPFormField>

            <ERPFormField
              label={t("expenses.approvedBy", { defaultValue: "Approved By" })}
              hint={
                approverOptions.length > 0
                  ? undefined
                  : t("expenses.approverFallbackHint", { defaultValue: "Left empty: recorded as approved by you" })
              }
            >
              <AppDropdown
                options={approverOptions}
                value={approvedBy}
                onChange={(val) => setApprovedBy(val || "")}
                placeholder={t("expenses.selectApproverPlaceholder", { defaultValue: "Select approver..." })}
              />
            </ERPFormField>
          </ERPFormGrid>

          <ERPFormGrid cols={2}>
            <ERPFormField label={t("expenses.deductFromFund")} required>
              <AppDropdown
                options={fundOptions}
                value={fundId}
                onChange={(val) => setFundId(val || "")}
                placeholder={t("expenses.selectFundPlaceholder", { defaultValue: "Select fund..." })}
              />
            </ERPFormField>

            <ERPFormField label="Amount" required>
              <input
                type="number"
                step="0.01"
                min="0.01"
                className="w-full px-3 py-2 text-xs bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </ERPFormField>
          </ERPFormGrid>

          <ERPFormGrid cols={2}>
            <ERPFormField label={t("expenses.expenseDate")}>
              <input
                type="date"
                className="w-full px-3 py-2 text-xs bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </ERPFormField>

            <ERPFormField label={t("expenses.expRef")} hint="Invoice or voucher reference number">
              <input
                type="text"
                className="w-full px-3 py-2 text-xs bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
                placeholder="e.g. INV-2026-001"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
              />
            </ERPFormField>
          </ERPFormGrid>

          <ERPFormField label={t("expenses.reasonDescription")} required>
            <textarea
              rows={3}
              className="w-full px-3 py-2 text-xs bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
              placeholder={t("expenses.justification")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </ERPFormField>
        </ERPFormSection>
      </ERPFormLayout>
    </TopSheet>
  );
}
