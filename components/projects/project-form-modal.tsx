"use client";

import React, { useState, useEffect, useMemo } from "react";
import { parseFieldError } from "@/lib/utils/errors";
import {
  TopSheet,
  ERPFormLayout,
  ERPFormSection,
  ERPFormGrid,
  ERPFormField,
  AppDropdown,
  DropdownOption,
  Button,
  ERPDatePicker,
  StatusBadge,
} from "@/components/ui";
import { NumericInput } from "@/components/ui/numeric-input";
import { Plus, Trash2, AlertCircle, Info, Landmark, Layers, Lock } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { useTenantCurrency, useTenantDateFormat, useTenantDistributionRules, useTenantProjectCategories } from "@/lib/use-tenant-settings";
import { parsePercentBp, toCents, fromCents } from "@/lib/money";
// The form derives the SAME contract amounts the server posts — lib/distribution-rules
// is the single owner (AGENTS §0), so the preview chip and the ledger cannot disagree.
import {
  PROJECT_MEMBER_ROLE,
  isProjectType,
  pmCapitalCents,
  splitPmCapitalCents,
  type ProjectType,
} from "@/lib/distribution-rules";
import { memberDisplayName } from "@/lib/member-display";
import { Project, Member } from "@/types";
import { formatMoney } from "@/lib/formatters";
import { intlLocaleFor, projectSectorLabel } from "./project-labels";

interface ShareholderInputRow {
  memberId: string;
  shares: number;
  sourceFundId: string;
}

/**
 * What the pre-save Review step shows (docs/PROJECT-TYPES_PLAN.md §6.1): the
 * entire split as derived integer cents, plus the payload it will post if the
 * admin confirms. Built from the same helpers the server uses, so the panel and
 * the ledger cannot tell two stories — and the panel carries the payload itself,
 * so confirming cannot post something other than what was reviewed.
 */
interface ReviewData {
  payload: Record<string, unknown>;
  projectType: ProjectType;
  budgetCents: number;
  contractCents: number;
  clubCapitalCents: number;
  clubCeilingCents: number;
  totalShares: number;
  pmPercent: string;
  club: Array<{
    memberId: string;
    name: string;
    code: string;
    role: string;
    shares: number;
    capitalCents: number;
  }>;
  projectMembers: Array<{ memberId: string; name: string; code: string; capitalCents: number }>;
}

interface ProjectFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (projectData: any) => Promise<void>;
  funds: Array<{ id: string; name: string; balance: number; type?: string; minimumBalance?: number }>;
  members?: Member[];
  tenantShareValue?: number;
  initialData?: Project | null;
}

export function ProjectFormModal({
  isOpen,
  onClose,
  onSubmit,
  funds,
  members = [],
  tenantShareValue = 1000,
  initialData,
}: ProjectFormModalProps) {
  const { t, locale } = useLocale();
  // Money on this screen is the tenant's money, so it carries the tenant's currency.
  const tenantCurrency = useTenantCurrency();
  const dateFormat = useTenantDateFormat();
  const fm = (n: number | string | null | undefined) => formatMoney(n, tenantCurrency, { locale: intlLocaleFor(locale) });

  // Basic Information
  const [title, setTitle] = useState(initialData?.title || "");
  const [category, setCategory] = useState(initialData?.category || "");
  const [description, setDescription] = useState(initialData?.description || "");
  const [status, setStatus] = useState<string>(initialData?.status || "In Progress");
  // #109: project manager selection. Persisted as projectFundHandler (the
  // existing varchar column the detail view renders as "Handler: …"); the
  // dropdown carries the member id, submit maps it back to the member's name.
  const [projectManagerId, setProjectManagerId] = useState<string | null>(null);

  // Financials & ROI
  const [budget, setBudget] = useState(initialData?.budget ? String(initialData.budget) : "");
  const [expectedRoi, setExpectedRoi] = useState(
    initialData?.expectedRoi !== undefined ? String(initialData.expectedRoi) : ""
  );
  /* ---- Project type (migration 0032, docs/PROJECT-TYPES_PLAN.md) -----------
   * `""` means "not chosen yet". Create starts there on purpose (AGENTS §15: no
   * default that pre-picks a money decision); edit pre-selects the STORED type,
   * which is recorded data, not a suggestion.
   *
   * The v9 meter that used to sit here — PM % summed against the club category
   * rules, with an "over 100%" state — is gone (decision D8). The two percentage
   * sets can no longer meet: a Club Level project has no Project Level Members,
   * and an Extra Investor project splits its remainder by share number. What is
   * left is the plain shape check plus the capital preview, which is the only
   * thing the number actually means now.
   * ------------------------------------------------------------------------ */
  const [projectType, setProjectType] = useState<ProjectType | "">(
    initialData ? isProjectType(initialData.projectType) ? initialData.projectType : "club_level" : ""
  );
  // The PM contract: ONE percentage for the project, never a per-member amount
  // (§2 D3 — k members, one deal). Blank = not filled yet.
  const [pmPercent, setPmPercent] = useState(
    initialData?.projectMemberPercent != null ? String(initialData.projectMemberPercent) : ""
  );
  // Project Level Member capital rows: source fund + member, NO share field.
  // Their money is the derived contract, so a shares box would be a lie.
  const [pmRows, setPmRows] = useState<Array<{ memberId: string; sourceFundId: string }>>([]);

  const isExtraInvestor = projectType === "extra_investor";
  const isClubLevel = projectType === "club_level";
  // The type is a ledger fact once the project has any posting: capital rows mean
  // 'Project Investment' legs exist, and capitalLocked means earnings/expenses
  // do. Either one locks it — the server (PUT) is still the authority.
  const typeLocked =
    Boolean(initialData?.capitalLocked) || (initialData?.involvedMembers?.length ?? 0) > 0;

  const distributionRules = useTenantDistributionRules();
  const clubPmPercent =
    distributionRules.find((r) => r.role === PROJECT_MEMBER_ROLE)?.percent ?? null;

  /** The contract percentage in basis points: null when blank, MoneyError when malformed. */
  const pmBpOrNull = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    return parsePercentBp(trimmed); // throws MoneyError on ≤0 / >100 / >2dp
  };
  let pmContractBp: number | null = null;
  let pmContractInvalid = false;
  try {
    pmContractBp = pmBpOrNull(pmPercent);
  } catch {
    pmContractInvalid = true;
  }

  // Fund Strategy: link existing vs create dedicated
  const [fundStrategy, setFundStrategy] = useState<"linkExisting" | "createNew">(
    initialData?.linkedFundId ? "linkExisting" : "linkExisting"
  );
  const [selectedFundId, setSelectedFundId] = useState<string | null>(initialData?.linkedFundId || null);
  const [newFundName, setNewFundName] = useState("");

  // Timeline & Dates
  const [startDate, setStartDate] = useState(initialData?.startDate || "");
  const [completionDate, setCompletionDate] = useState(initialData?.completionDate || "");

  // Shareholders & Equity Allocation (Option A) — the same editor on create and
  // edit. On edit it is prefilled from the ledger, and locked once the project
  // has earnings or expenses (their capital structure is history).
  const [shareholders, setShareholders] = useState<ShareholderInputRow[]>([]);
  const capitalLocked = Boolean(initialData?.capitalLocked);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Set by the first Save (validation passed) and consumed by the Review panel;
  // null means the form is being edited. Not a wizard — one deliberate pause.
  const [review, setReview] = useState<ReviewData | null>(null);
  // Server-side rejection of the contract (a roster the type cannot hold, a
  // percent the rule owner refuses) — anchored under the Project Level Members
  // block, cleared when the user edits the field or reopens the form.
  const [pmServerError, setPmServerError] = useState<string | null>(null);
  const pmFieldError: string | null = pmContractInvalid
    ? t("projects.form.pmPercentRange", {
        defaultValue: "Enter a percentage above 0 and at most 100 (maximum two decimals).",
      })
    : pmServerError;

  // Reset form when modal opens with initialData
  useEffect(() => {
    if (initialData) {
      setTitle(initialData.title || "");
      setCategory(initialData.category || "");
      setDescription(initialData.description || "");
      setBudget(initialData.budget ? String(initialData.budget) : "");
      setExpectedRoi(initialData.expectedRoi !== undefined ? String(initialData.expectedRoi) : "");
      setProjectType(
        isProjectType(initialData.projectType) ? initialData.projectType : "club_level"
      );
      setPmPercent(initialData.projectMemberPercent != null ? String(initialData.projectMemberPercent) : "");
      setStartDate(initialData.startDate || "");
      setCompletionDate(initialData.completionDate || "");
      setSelectedFundId(initialData.linkedFundId || null);
      setStatus(initialData.status || "In Progress");
      setFundStrategy("linkExisting");
      // One roster, two editors: the membership category decides which section a
      // participant belongs to, exactly as it decides how they fund (0032). The
      // category comes from the participation row itself (`memberRole`, joined by
      // the detail endpoint) rather than from the `members` prop — reading the
      // prop here would make this reset effect depend on an array whose identity
      // changes on every refetch, wiping the form mid-edit.
      const participants = initialData.involvedMembers || [];
      const isPmRow = (p: (typeof participants)[number]) => p.memberRole === PROJECT_MEMBER_ROLE;
      setShareholders(
        participants
          .filter((p) => !isPmRow(p))
          .map((p) => ({
            memberId: p.memberId,
            shares: Number(p.sharesInvested || 0),
            sourceFundId: p.sourceFundId || "",
          })),
      );
      setPmRows(
        participants
          .filter(isPmRow)
          .map((p) => ({ memberId: p.memberId, sourceFundId: p.sourceFundId || "" })),
      );
      setProjectManagerId(
        initialData.projectFundHandler
          ? members.find((m) => m.name === initialData.projectFundHandler)?.id ?? null
          : null
      );
    } else {
      setTitle("");
      setCategory("");
      setDescription("");
      setBudget("");
      setExpectedRoi("");
      setProjectType("");
      setPmPercent("");
      setPmRows([]);
      setStartDate("");
      setCompletionDate("");
      setSelectedFundId(null);
      setNewFundName("");
      setStatus("In Progress");
      setFundStrategy("linkExisting");
      setShareholders([]);
      setProjectManagerId(null);
    }
    setReview(null);
    setErrorMessage(null);
    setPmServerError(null);
  }, [initialData, isOpen]);

  const fundOptions: DropdownOption[] = funds.map((f) => ({
    value: f.id,
    label: `${f.name} (Bal: ${fm(f.balance)})`,
  }));

  const memberOptions: DropdownOption[] = members.map((m) => {
    const depositBal = Number(m.totalContributed || 0);
    return {
      value: m.id,
      label: `${memberDisplayName(m.name, m.status)} (${m.memberId}) — Bal: ${fm(depositBal)}`,
      // Suspended members cannot be assigned to new work; the current manager
      // of the edited project stays selectable so the field never blanks
      // (manager persists as the member's name in projectFundHandler).
      disabled: m.status === "suspended" && m.name !== initialData?.projectFundHandler,
    };
  });

  // Invested capital has to leave a real deposit fund, so project funds are not
  // offered as a source (a project cannot fund itself out of its own balance).
  // The destination fund is excluded too: drawing from it would credit the
  // project fund with no matching debit, which the server rejects. Funds with
  // no spendable cash (balance already at or below their minimum reserve) are
  // not offered at all — they cannot fund an investment.
  const sourceFundOptions: DropdownOption[] = funds
    .filter((f) => (f.type || '').toUpperCase() !== 'PROJECT')
    .filter((f) => !(fundStrategy === 'linkExisting' && f.id === selectedFundId))
    .filter((f) => Number(f.balance || 0) - Number(f.minimumBalance || 0) > 0)
    .map((f) => ({ value: f.id, label: `${f.name} (Bal: ${fm(f.balance)})` }));

  // A prefilled allocation must stay visible even if that fund no longer
  // qualifies as a source (drained balance, retype), otherwise an edit would
  // show an empty fund for money that is really there.
  const sourceOptionsForRow = (selected: string): DropdownOption[] => {
    if (!selected || sourceFundOptions.some((o) => o.value === selected)) return sourceFundOptions;
    const fund = funds.find((f) => f.id === selected);
    return [
      ...sourceFundOptions,
      { value: selected, label: fund ? `${fund.name} (Bal: ${fm(fund.balance)})` : selected },
    ];
  };

  // Sectors this tenant defined in Settings. Old projects keep their stored
  // sector string even after it is removed from the list (see lib/categories).
  const projectCategories = useTenantProjectCategories();
  const categoryOptions: DropdownOption[] = projectCategories.map((label) => ({
    value: label,
    label: projectSectorLabel(t, label),
  }));

  const statusOptions: DropdownOption[] = [
    { value: "In Progress", label: t("projects.statuses.inProgress", { defaultValue: "In Progress" }) },
    { value: "Review", label: t("projects.statuses.review", { defaultValue: "Review" }) },
    { value: "Completed", label: t("projects.statuses.completed", { defaultValue: "Completed" }) },
  ];

  // Helper calculations for shareholders
  const totalShares = shareholders.reduce((acc, s) => acc + (Number(s.shares) || 0), 0);
  const totalShareholderCapital = totalShares * tenantShareValue;
  // Total Budget is the ceiling on capital raised — the server rejects an
  // over-subscription, so flag it live instead of letting the submit fail.
  const numBudgetInput = parseFloat(budget) || 0;

  /* ---- The contract, derived exactly as lib/project-capital.ts derives it ---
   * Same helpers, same order, integer cents. This is a PREVIEW of money the
   * server will re-derive from the budget and the percentage it is sent; the
   * client never sends an amount for a Project Level Member.
   * ------------------------------------------------------------------------ */
  const budgetCents = toCents(numBudgetInput);
  // Per-row toCents then sum — the same shape as the server's accumulator, so a
  // half-poisha budget cannot round differently in the two places.
  const clubCapitalCents = shareholders.reduce(
    (acc, s) => acc + toCents((Number(s.shares) || 0) * tenantShareValue),
    0,
  );
  const pmRowIds = pmRows.map((r) => r.memberId).filter(Boolean).sort();
  const contractCents =
    isExtraInvestor && pmRowIds.length > 0 && pmContractBp !== null
      ? pmCapitalCents(budgetCents, pmContractBp)
      : 0;
  const contractByPm =
    contractCents > 0 ? splitPmCapitalCents(contractCents, pmRowIds) : new Map<string, number>();
  // What Board + Shareholder may still fund. Equals the budget on a club project,
  // so the one comparison below covers both types.
  const clubCeilingCents = budgetCents - contractCents;
  const overBudget = !capitalLocked && clubCapitalCents > clubCeilingCents;

  // On edit the server refunds this project's existing allocation before
  // re-investing, so a member's headroom is their live equity PLUS what this
  // project already holds from them. Comparing against raw equity alone makes
  // an unchanged row look permanently under-funded.
  const committedByMember = new Map<string, number>();
  const committedByFund = new Map<string, number>();
  for (const p of initialData?.involvedMembers || []) {
    const invested = Number(p.totalInvested || 0);
    if (!invested) continue;
    committedByMember.set(p.memberId, (committedByMember.get(p.memberId) ?? 0) + invested);
    if (p.sourceFundId) {
      committedByFund.set(p.sourceFundId, (committedByFund.get(p.sourceFundId) ?? 0) + invested);
    }
  }

  // Shareholder picker shows the amount the member can actually invest here —
  // live equity plus this project's existing holdback — not raw equity, which
  // an edit has already deducted.
  // The membership category decides which editor a member appears in, because it
  // decides how they fund: a Project Level Member funds a contract and holds no
  // shares, so offering one in the share grid would only produce the server's
  // PM_HOLDS_NO_SHARES refusal. (Which PM is already bound to ANOTHER project is
  // not in this payload — the one-project rule stays enforced where the rows are
  // locked, lib/project-capital.ts, and its message names the member.)
  const isProjectMember = (memberId: string) =>
    members.find((m) => m.id === memberId)?.role === PROJECT_MEMBER_ROLE;

  const shareholderMemberOptions: DropdownOption[] = members
    .filter((m) => m.role !== PROJECT_MEMBER_ROLE)
    .map((m) => ({
      value: m.id,
      label: `${memberDisplayName(m.name, m.status)} (${m.memberId}) — Bal: ${fm(Number(m.totalContributed || 0) + (committedByMember.get(m.id) ?? 0))}`,
      // Suspended members cannot (re-)invest in a project — the server rejects
      // it; the UI says so up front. An existing allocation on the edited
      // project stays selectable so its row is never blanked.
      disabled: m.status === "suspended" && !initialData?.involvedMembers?.some((p) => p.memberId === m.id),
    }));

  const projectMemberOptions: DropdownOption[] = members
    .filter((m) => m.role === PROJECT_MEMBER_ROLE)
    .map((m) => ({
      value: m.id,
      label: `${memberDisplayName(m.name, m.status)} (${m.memberId}) — Bal: ${fm(Number(m.totalContributed || 0) + (committedByMember.get(m.id) ?? 0))}`,
      disabled: m.status === "suspended" && !initialData?.involvedMembers?.some((p) => p.memberId === m.id),
    }));

  const handleAddPmRow = () => setPmRows((prev) => [...prev, { memberId: "", sourceFundId: "" }]);
  const handleRemovePmRow = (index: number) => setPmRows((prev) => prev.filter((_, i) => i !== index));
  const handlePmRowChange = (
    index: number,
    field: "memberId" | "sourceFundId",
    value: string,
  ) => {
    setPmRows((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        // §5 again: the source fund is the parent, so changing it clears the
        // member chosen under it rather than leaving a fund/member mismatch.
        if (field === "sourceFundId") return { ...row, sourceFundId: value, memberId: "" };
        return { ...row, memberId: value };
      }),
    );
  };

  /**
   * Changing the project type resets the roster that type cannot hold (§5: never
   * leave a value that the new parent makes invalid). Extra → Club drops the PM
   * rows and their percentage; Club → Extra keeps the share rows, which are legal
   * in both, and waits for the contract that the Extra section now demands.
   */
  const handleTypeChange = (next: ProjectType) => {
    if (next === projectType) return;
    setProjectType(next);
    setPmServerError(null);
    if (next === "club_level") {
      setPmRows([]);
      setPmPercent("");
    }
  };

  const handleAddShareholder = () => {
    setShareholders((prev) => [...prev, { memberId: "", shares: 1, sourceFundId: "" }]);
  };

  const handleRemoveShareholder = (index: number) => {
    setShareholders((prev) => prev.filter((_, i) => i !== index));
  };

  const handleShareholderChange = (index: number, field: "memberId" | "shares" | "sourceFundId", value: any) => {
    setShareholders((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        if (field === "memberId") {
          return { ...row, memberId: String(value || "") };
        }
        if (field === "sourceFundId") {
          // §5: changing the parent (source fund) resets the dependent member,
          // because the chosen member's deposit may not live in this fund.
          return { ...row, sourceFundId: String(value || ""), memberId: "" };
        }
        return { ...row, shares: Number(value) || 1 };
      })
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!title.trim()) {
      setErrorMessage(t("projects.validation.titleRequired", { defaultValue: "Project title is required." }));
      return;
    }
    if (!category) {
      setErrorMessage(t("projects.validation.categoryRequired", { defaultValue: "Category is required." }));
      return;
    }
    if (!startDate) {
      setErrorMessage(t("projects.validation.startDateRequired", { defaultValue: "Start date is required." }));
      return;
    }

    const numBudget = parseFloat(budget);
    if (isNaN(numBudget) || numBudget < 0) {
      setErrorMessage(t("projects.validation.validBudget", { defaultValue: "Valid budget is required." }));
      return;
    }

    if (fundStrategy === "createNew" && !newFundName.trim() && !title.trim()) {
      setErrorMessage(t("projects.validation.fundNameRequired", { defaultValue: "Dedicated fund name is required." }));
      return;
    }

    // Project type (migration 0032) is the first gate: it decides who funds and
    // how returns split, so nothing below can be validated without it. No
    // pre-selection on create (§15) — an unchosen type is a refusal, not a default.
    if (!projectType) {
      setErrorMessage(
        t("projects.validation.typeRequired", {
          defaultValue: "Choose the project type: Club Level or Extra Investor.",
        }),
      );
      return;
    }
    setPmServerError(null);
    let pmPercentPayload: string | null | undefined;
    if (isClubLevel) {
      // A Club Level project has no Project Level Members, so it carries no
      // percentage either — null on edit clears a stored one (the server refuses
      // a club project that keeps one).
      pmPercentPayload = initialData ? null : undefined;
    } else {
      const pmTrimmed = pmPercent.trim();
      if (pmContractInvalid) {
        setErrorMessage(
          t("projects.form.pmPercentRange", {
            defaultValue: "Enter a percentage above 0 and at most 100 (maximum two decimals).",
          }),
        );
        return;
      }
      const hasPmRow = pmRows.some((r) => r.memberId);
      if (pmTrimmed === "" && hasPmRow) {
        setErrorMessage(
          t("projects.validation.pmPercentRequired", {
            defaultValue:
              "This project has Project Level Members, so their contract percentage is required.",
          }),
        );
        return;
      }
      pmPercentPayload = pmTrimmed === "" ? (initialData ? null : undefined) : pmTrimmed;
    }

    // Validate shareholders
    const validShareholders: Array<{ memberId: string; shares: number; sourceFundId: string }> = [];
    const seenIds = new Set<string>();
    const drawBySourceFund = new Map<string, number>();

    for (const sh of shareholders) {
      if (!sh.memberId) continue;
      // While locked the rows are display-only, so their balances and (for
      // allocations pred migration 0015) possibly unknown source funds are not
      // re-validated — nothing about them can change.
      if (!sh.sourceFundId && !capitalLocked) {
        setErrorMessage(
          t("projects.shareholders.sourceFundRequired", {
            defaultValue: "Select the deposit fund each shareholder's capital is drawn from.",
          }),
        );
        return;
      }
      if (seenIds.has(sh.memberId)) {
        setErrorMessage(t("projects.validation.duplicateShareholder", { defaultValue: "Each member can only be added once as a shareholder." }));
        return;
      }
      seenIds.add(sh.memberId);

      const shares = Number(sh.shares);
      if (isNaN(shares) || shares < 1) {
        setErrorMessage(t("projects.validation.invalidShares", { defaultValue: "Shares must be at least 1." }));
        return;
      }

      // Locked rows pass through untouched — no balance math to re-validate.
      if (capitalLocked) {
        validShareholders.push({ memberId: sh.memberId, shares, sourceFundId: sh.sourceFundId });
        continue;
      }

      // Check deposit balance — headroom counts what this project already holds
      // from the member, because the edit refunds it before re-investing.
      const member = members.find((m) => m.id === sh.memberId);
      const memberBalance =
        Number(member?.totalContributed || 0) + (committedByMember.get(sh.memberId) ?? 0);
      const requiredCapital = shares * tenantShareValue;

      if (memberBalance < requiredCapital) {
        setErrorMessage(
          `${member?.name || "Member"} has insufficient deposit balance (Available: ${fm(memberBalance)}, Required: ${fm(requiredCapital)})`
        );
        return;
      }

      // Cash side: the chosen fund must still hold the capital after every
      // draw assigned to it, keeping its minimum reserve.
      const sourceFund = funds.find((f) => f.id === sh.sourceFundId);
      if (!sourceFund) {
        setErrorMessage(t("projects.shareholders.sourceFundRequired", { defaultValue: "Select the deposit fund each shareholder's capital is drawn from." }));
        return;
      }
      const alreadyDrawnCents = Math.round((drawBySourceFund.get(sourceFund.id) ?? 0) * 100);
      const requiredCents = Math.round(requiredCapital * 100);
      // Same refund-before-reinvest logic on the cash side.
      const fundHeadroomCents = Math.round(
        (Number(sourceFund.balance) + (committedByFund.get(sourceFund.id) ?? 0)) * 100,
      );
      const availableCents = fundHeadroomCents - alreadyDrawnCents;
      const reserveCents = Math.round((sourceFund.minimumBalance ?? 0) * 100);
      if (!capitalLocked && availableCents - requiredCents < reserveCents) {
        setErrorMessage(
          `${sourceFund.name} has insufficient balance for this investment (Available: ${fm(availableCents / 100)}, Required: ${fm(requiredCents / 100)})`
        );
        return;
      }
      drawBySourceFund.set(sourceFund.id, (drawBySourceFund.get(sourceFund.id) ?? 0) + requiredCapital);

      validShareholders.push({ memberId: sh.memberId, shares, sourceFundId: sh.sourceFundId });
    }

    /* ---- Project Level Member rows (Extra Investor only) -------------------
     * A PM row carries a member and the fund their contract is drawn from, and
     * NOTHING else: no share number, no amount. Both come from the project's
     * budget and percentage on the server, and are re-derived here only to show
     * and pre-check the same figures (§4: the entered percentage is an
     * agreement, the money is always derived from it).
     * ---------------------------------------------------------------------- */
    const validPmRows: Array<{ memberId: string; shares: 0; sourceFundId: string }> = [];
    if (isExtraInvestor && !capitalLocked) {
      for (const row of pmRows) {
        if (!row.memberId && !row.sourceFundId) continue;
        if (!row.memberId || !row.sourceFundId) {
          setErrorMessage(
            t("projects.form.pmRowIncomplete", {
              defaultValue: "Each Project Level Member needs both a source deposit fund and a member.",
            }),
          );
          return;
        }
        if (seenIds.has(row.memberId)) {
          setErrorMessage(
            t("projects.validation.duplicateShareholder", {
              defaultValue: "Each member can only be added once as a shareholder.",
            }),
          );
          return;
        }
        seenIds.add(row.memberId);

        const obligationCents = contractByPm.get(row.memberId) ?? 0;
        const member = members.find((m) => m.id === row.memberId);
        const memberBalanceCents = toCents(
          Number(member?.totalContributed || 0) + (committedByMember.get(row.memberId) ?? 0),
        );
        if (memberBalanceCents < obligationCents) {
          setErrorMessage(
            `${member?.name || t("projects.shareholderMember", { defaultValue: "Member" })} ${t(
              "projects.shareholders.insufficientForContract",
              {
                available: fm(memberBalanceCents / 100),
                required: fm(obligationCents / 100),
                defaultValue: `cannot fund its contract share (Available: ${fm(memberBalanceCents / 100)}, Required: ${fm(obligationCents / 100)}).`,
              },
            )}`,
          );
          return;
        }
        const sourceFund = funds.find((f) => f.id === row.sourceFundId);
        if (!sourceFund) {
          setErrorMessage(
            t("projects.shareholders.sourceFundRequired", {
              defaultValue: "Select the deposit fund each shareholder's capital is drawn from.",
            }),
          );
          return;
        }
        const alreadyDrawnCents = Math.round((drawBySourceFund.get(sourceFund.id) ?? 0) * 100);
        const fundHeadroomCents = Math.round(
          (Number(sourceFund.balance) + (committedByFund.get(sourceFund.id) ?? 0)) * 100,
        );
        const reserveCents = Math.round((sourceFund.minimumBalance ?? 0) * 100);
        if (fundHeadroomCents - alreadyDrawnCents - obligationCents < reserveCents) {
          setErrorMessage(
            `${sourceFund.name} ${t("projects.shareholders.insufficientFundForContract", {
              available: fm((fundHeadroomCents - alreadyDrawnCents) / 100),
              required: fm(obligationCents / 100),
              defaultValue: `cannot fund this contract (Available: ${fm((fundHeadroomCents - alreadyDrawnCents) / 100)}, Required: ${fm(obligationCents / 100)}).`,
            })}`,
          );
          return;
        }
        drawBySourceFund.set(sourceFund.id, (drawBySourceFund.get(sourceFund.id) ?? 0) + obligationCents / 100);
        validPmRows.push({ memberId: row.memberId, shares: 0, sourceFundId: row.sourceFundId });
      }
    }

    // Hard gate mirroring the server: subscribed capital may never exceed what
    // the budget allows — which, on an Extra Investor project, is the budget
    // MINUS the contract the Project Level Members have already committed to.
    const submittedCapitalCents = clubCapitalCents + (capitalLocked ? 0 : contractCents);
    if (!capitalLocked && submittedCapitalCents > budgetCents) {
      setErrorMessage(
        contractCents > 0
          ? t("projects.validation.capitalExceedsClubCeiling", {
              invested: fm(clubCapitalCents / 100),
              ceiling: fm(clubCeilingCents / 100),
              contract: fm(contractCents / 100),
              budget: fm(numBudget),
              defaultValue: `Board and Shareholder capital (${fm(clubCapitalCents / 100)}) exceeds what the Project Level Member contract leaves of the budget (${fm(clubCeilingCents / 100)}). Contract: ${fm(contractCents / 100)} of ${fm(numBudget)}.`,
            })
          : t("projects.validation.capitalExceedsBudget", {
              invested: fm(submittedCapitalCents / 100),
              budget: fm(numBudget),
              defaultValue: `Total shareholder investment (${fm(submittedCapitalCents / 100)}) cannot exceed the project budget (${fm(numBudget)}).`,
            }),
      );
      return;
    }

    const managerMember = members.find((m) => m.id === projectManagerId);
    const payload: Record<string, unknown> = {
      title: title.trim(),
      category,
      description: description.trim(),
      budget: numBudget,
      // initialInvestment is never sent: both create and edit derive it from
      // the capital actually drawn from shareholder deposits (§12).
      expectedRoi: parseFloat(expectedRoi) || 0,
      // undefined omits the key (create without a contract); null on edit clears
      // a stored one.
      projectMemberPercent: pmPercentPayload,
      // Always sent once chosen: on create it records the decision, on edit an
      // unchanged value is a no-op and a changed one hits the D5 ledger lock.
      projectType,
      startDate,
      completionDate: completionDate || undefined,
      linkedFundId: fundStrategy === "linkExisting" ? (selectedFundId || undefined) : undefined,
      // A dedicated fund can only be minted at creation; an edit re-links.
      createNewFund: !initialData && fundStrategy === "createNew",
      newFundName: !initialData && fundStrategy === "createNew" ? (newFundName.trim() || `${title.trim()} Fund`) : undefined,
      status,
      // Prefilled on edit. PUT compares it against the ledger: identical means
      // no money moves, different means the allocation is refunded and
      // re-invested. While locked it is not sent at all — nothing may change.
      // PM rows ride along at shares 0; the server derives their capital.
      shareholders: capitalLocked ? undefined : [...validShareholders, ...validPmRows],
      projectFundHandler: managerMember?.name || undefined,
    };

    // The deliberate pause the deal needs (§6.1): nothing is posted until the
    // admin has seen the whole split — who funds what, and that the two sides
    // add up to the deal they think they are making.
    setReview({
      payload,
      projectType,
      budgetCents,
      contractCents: capitalLocked ? 0 : contractCents,
      clubCapitalCents,
      clubCeilingCents,
      totalShares,
      pmPercent: pmPercent.trim(),
      club: validShareholders.map((s) => {
        const member = members.find((m) => m.id === s.memberId);
        return {
          memberId: s.memberId,
          name: member?.name ?? s.memberId,
          code: member?.memberId ?? "",
          role: member?.role ?? "Shareholder Member",
          shares: s.shares,
          capitalCents: toCents(s.shares * tenantShareValue),
        };
      }),
      projectMembers: validPmRows.map((r) => ({
        memberId: r.memberId,
        name: members.find((m) => m.id === r.memberId)?.name ?? r.memberId,
        code: members.find((m) => m.id === r.memberId)?.memberId ?? "",
        capitalCents: contractByPm.get(r.memberId) ?? 0,
      })),
    });
    setErrorMessage(null);
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  };

  /** Second click: the reviewed payload, posted exactly as displayed. */
  const confirmReview = async () => {
    if (!review) return;
    try {
      setIsSubmitting(true);
      await onSubmit(review.payload);
      onClose();
    } catch (err: any) {
      // §11 field-coded rejections arrive as "[Field 'x', Code: Y] sentence".
      // Route a projectMemberPercent refusal to its input (the same place the
      // live meter complains), so the fix is obvious; anything else keeps the
      // whole sentence in the banner. parseFieldError is the shared reader of
      // the wire format (lib/utils/errors) — raw bracket text never leaks.
      const parsed = parseFieldError(err?.message ? String(err.message) : "");
      // Any refusal naming the contract field, or the roster the contract
      // describes, belongs under the Project Level Members block — that is the
      // only place it can be fixed. Leaving the review panel open would hide the
      // message behind a summary of a deal the server just rejected.
      if (
        parsed.field === "projectMemberPercent" ||
        parsed.field === "shareholders" ||
        parsed.field === "projectType"
      ) {
        setReview(null);
        setPmServerError(parsed.message);
        setErrorMessage(parsed.message);
      } else {
        setErrorMessage(
          parsed.message || t("common.errors.failedToCreateProject", { defaultValue: "Failed to save project" }),
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <TopSheet
      isOpen={isOpen}
      onClose={onClose}
      title={initialData ? t("projects.editProject", { defaultValue: "Edit Project" }) : t("projects.newProject", { defaultValue: "New Project Master" })}
      description={t("projects.formDescription", { defaultValue: "Define project capital requirements, linked fund, and shareholder equity allocations." })}
    >
      <form method="post" onSubmit={handleSubmit} className="space-y-6">
        {errorMessage && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs rounded-xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{errorMessage}</span>
          </div>
        )}

        {review && (
          /* ------------------------------------------------------------------
             Review before saving (§6.1). This is the deal as the ledger will
             record it: every participant, what they fund, and the two totals
             that have to add up. Nothing here is re-rounded for display — the
             figures are the same integer cents the server is about to post, and
             Confirm posts the exact payload that was built to produce them.
             ------------------------------------------------------------------ */
          <ERPFormSection title={t("projects.review.title", { defaultValue: "Review the split before saving" })}>
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2 text-[11px] font-mono">
                <span className="px-2 py-1 rounded-lg bg-primary/10 text-primary border border-primary/20">
                  {review.projectType === "extra_investor"
                    ? t("projects.review.typeExtra", { defaultValue: "Extra Investor" })
                    : t("projects.form.typeClub", { defaultValue: "Club Level" })}
                </span>
                <span className="px-2 py-1 rounded-lg bg-muted/40 text-muted-foreground border border-border/70">
                  {t("projects.review.budget", {
                    amount: fm(review.budgetCents / 100),
                    defaultValue: `Budget ${fm(review.budgetCents / 100)}`,
                  })}
                </span>
                {review.projectType === "extra_investor" && (
                  <span className="px-2 py-1 rounded-lg bg-muted/40 text-muted-foreground border border-border/70">
                    {t("projects.review.contract", {
                      percent: review.pmPercent || "0",
                      defaultValue: `Project Level Members contract ${review.pmPercent || "0"}%`,
                    })}
                  </span>
                )}
              </div>

              <div className="border border-border/80 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-2 text-start font-bold">{t("projects.review.member", { defaultValue: "Member" })}</th>
                      <th className="px-3 py-2 text-start font-bold">{t("projects.review.category", { defaultValue: "Category" })}</th>
                      <th className="px-3 py-2 text-end font-bold">{t("projects.review.weight", { defaultValue: "Weight" })}</th>
                      <th className="px-3 py-2 text-end font-bold">{t("projects.review.capital", { defaultValue: "Capital" })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {review.projectMembers.map((r) => (
                      <tr key={r.memberId} className="border-t border-border/60">
                        <td className="px-3 py-2 text-foreground">
                          {r.name}
                          <span className="ms-1 text-[10px] text-muted-foreground font-mono">{r.code}</span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {t("projects.review.categoryPm", { defaultValue: "Project Level Member" })}
                        </td>
                        <td className="px-3 py-2 text-end font-mono text-muted-foreground">
                          {t("projects.review.weightContract", { defaultValue: "contract" })}
                        </td>
                        <td className="px-3 py-2 text-end font-mono font-semibold text-foreground">
                          {fm(r.capitalCents / 100)}
                        </td>
                      </tr>
                    ))}
                    {review.club.map((r) => (
                      <tr key={r.memberId} className="border-t border-border/60">
                        <td className="px-3 py-2 text-foreground">
                          {r.name}
                          <span className="ms-1 text-[10px] text-muted-foreground font-mono">{r.code}</span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{r.role}</td>
                        <td className="px-3 py-2 text-end font-mono text-muted-foreground">
                          {review.totalShares > 0
                            ? `${((r.shares / review.totalShares) * 100).toFixed(2)}%`
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-end font-mono font-semibold text-foreground">
                          {fm(r.capitalCents / 100)}
                        </td>
                      </tr>
                    ))}
                    {review.club.length === 0 && review.projectMembers.length === 0 && (
                      <tr className="border-t border-border/60">
                        <td colSpan={4} className="px-3 py-3 text-center text-muted-foreground">
                          {t("projects.review.nobody", {
                            defaultValue: "No one is funding this project yet — you can add participants later.",
                          })}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* The two totals. On an Extra Investor project the percentages
                  live in two separate pots, and saying so is the whole point of
                  showing this panel: contract % of the pool + the club's 100% of
                  what is left = 100% of the project. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono">
                <div className="p-3 rounded-xl bg-muted/30 border border-border/60">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    {t("projects.review.potPm", { defaultValue: "Project Level Members" })}
                  </div>
                  <div className="flex justify-between text-foreground">
                    <span>{t("projects.review.potPercentOfPool", { defaultValue: "% of the member pool" })}</span>
                    <strong>{review.projectType === "extra_investor" ? `${review.pmPercent || "0"}%` : "0%"}</strong>
                  </div>
                  <div className="flex justify-between text-foreground">
                    <span>{t("projects.review.potCapital", { defaultValue: "capital" })}</span>
                    <strong>{fm(review.contractCents / 100)}</strong>
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-muted/30 border border-border/60">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    {t("projects.review.potClub", { defaultValue: "Board + Shareholders" })}
                  </div>
                  <div className="flex justify-between text-foreground">
                    <span>{t("projects.review.potPercentOfRemainder", { defaultValue: "% of what the contract leaves" })}</span>
                    <strong>100%</strong>
                  </div>
                  <div className="flex justify-between text-foreground">
                    <span>{t("projects.review.potCapital", { defaultValue: "capital" })}</span>
                    <strong>{fm(review.clubCapitalCents / 100)}</strong>
                  </div>
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {t("projects.review.addsUp", {
                  total: fm((review.contractCents + review.clubCapitalCents) / 100),
                  ceiling: fm(review.budgetCents / 100),
                  // The sentence differs per type because the SPLIT differs; the
                  // interpolation is passed in so no locale file has to encode
                  // the rule itself.
                  split:
                    review.projectType === "extra_investor"
                      ? t("projects.review.splitExtra", {
                          percent: review.pmPercent || "0",
                          defaultValue: `${review.pmPercent || "0"}% contract, then 100% of the remainder by share number`,
                        })
                      : t("projects.review.splitClub", {
                          defaultValue: "100% by the category rules and share numbers",
                        }),
                  defaultValue: `Capital total ${fm((review.contractCents + review.clubCapitalCents) / 100)} of the ${fm(review.budgetCents / 100)} budget. The member pool splits as ${
                    review.projectType === "extra_investor" ? `${review.pmPercent || "0"}% contract + 100% of the remainder` : "100% by share number"
                  } — that is 100% of the project, once.`,
                })}
              </p>
            </div>
          </ERPFormSection>
        )}

        {!review && (<>{/* Section 1: General Details */}
        <ERPFormSection title={t("projects.basicDetails", { defaultValue: "General Information" })}>
          <ERPFormGrid cols={2}>
            <ERPFormField label={t("projects.title", { defaultValue: "Project Title *" })}>
              <input
                type="text"
                placeholder={t("projects.titlePlaceholder", { defaultValue: "e.g. Dhaka Commercial Plaza" })}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
              />
            </ERPFormField>

            <ERPFormField label={t("projects.category", { defaultValue: "Category *" })}>
              <AppDropdown
                options={categoryOptions}
                value={category}
                onChange={(val) => setCategory(val || "")}
                placeholder={t("projects.selectCategory", { defaultValue: "Select category..." })}
              />
            </ERPFormField>

            <ERPFormField label={t("projects.projectManager", { defaultValue: "Project Manager" })}>
              <AppDropdown
                options={memberOptions}
                value={projectManagerId}
                onChange={(val) => setProjectManagerId(val || null)}
                placeholder={t("projects.projectManagerPlaceholder", { defaultValue: "Select member (optional)..." })}
              />
            </ERPFormField>
          </ERPFormGrid>

          <ERPFormField label={t("projects.description", { defaultValue: "Project Description" })}>
            <textarea
              rows={3}
              placeholder={t("projects.descriptionPlaceholder", { defaultValue: "Comprehensive project scope, objectives and deliverables..." })}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
            />
          </ERPFormField>
        </ERPFormSection>

        {/* Section 1b: Project type (migration 0032). Nothing else on this form
            means anything until this is chosen: the type decides who may be on
            the roster, what each participant funds with, and which engine splits
            the returns. Deliberately UNSET on create — a pre-selected card would
            be the app making a money decision nobody asked it to make (§15). */}
        <ERPFormSection title={t("projects.form.typeSection", { defaultValue: "Project Type" })}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(["club_level", "extra_investor"] as const).map((value) => {
              const selected = projectType === value;
              const isExtra = value === "extra_investor";
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => !typeLocked && handleTypeChange(value)}
                  disabled={typeLocked && !selected}
                  aria-pressed={selected}
                  className={`text-start p-3 rounded-xl border text-left transition-colors ${
                    selected
                      ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                      : "border-border/80 bg-card hover:border-primary/50"
                  } ${typeLocked && !selected ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <span className="flex items-center gap-2">
                    {isExtra ? (
                      <Layers className="w-4 h-4 text-primary inline mr-1.5" />
                    ) : (
                      <Landmark className="w-4 h-4 text-primary inline mr-1.5" />
                    )}
                    <span className="text-xs font-bold text-foreground">
                      {isExtra
                        ? t("projects.form.typeExtra", { defaultValue: "Extra Investor" })
                        : t("projects.form.typeClub", { defaultValue: "Club Level" })}
                    </span>
                  </span>
                  <span className="block mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                    {isExtra
                      ? t("projects.form.typeExtraHint", {
                          defaultValue:
                            "Adds Project Level Members. Their contract percentage of the budget is funded first; Board and Shareholders fund the rest and split the remaining profit purely by share number.",
                        })
                      : t("projects.form.typeClubHint", {
                          defaultValue:
                            "Board and Shareholder Members only. Capital by shares, returns by the category rules in Settings → Financial.",
                        })}
                  </span>
                </button>
              );
            })}
          </div>
          {typeLocked && (
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground flex items-start gap-1.5">
              <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                {t("projects.form.typeLockedNote", {
                  defaultValue:
                    "This project already has ledger entries, so its type can no longer be changed — the capital and returns were recorded under the rules it was created with.",
                })}
              </span>
            </p>
          )}
        </ERPFormSection>

        {/* Section 2: Financials & Budget */}
        <ERPFormSection title={t("projects.financials", { defaultValue: "Capital & ROI Projection" })}>
          <ERPFormGrid cols={3}>
            <ERPFormField label={t("projects.budget", { defaultValue: "Total Budget *" })}>
              <NumericInput
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
              />
            </ERPFormField>

            <ERPFormField label={t("projects.initialInvestment", { defaultValue: "Initial Investment" })}>
              <div className="px-3 py-2 text-xs font-mono font-semibold text-foreground bg-muted/30 border border-border/60 rounded-xl">
                {fm(initialData ? Number(initialData.initialInvestment || 0) : totalShareholderCapital)}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {t("projects.initialInvestmentFromDeposits", {
                  defaultValue: "Auto-funded: drawn from shareholder deposit balances, never entered manually.",
                })}
              </p>
            </ERPFormField>

            <ERPFormField label={t("projects.expectedRoi", { defaultValue: "Expected ROI (%)" })}>
              <NumericInput
                type="number"
                step="0.1"
                min="0"
                placeholder="15.0"
                value={expectedRoi}
                onChange={(e) => setExpectedRoi(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
              />
            </ERPFormField>
          </ERPFormGrid>

          {/* Project Level Member CONTRACT (migration 0032): one percentage for
              the whole project, from which every PM obligation is derived. It is
              a share OF THE BUDGET, not of the member pool — that is what makes
              the amount knowable before anyone subscribes (§2 D2). The field is
              meaningless on a club project, which has no PMs, so it only exists
              once Extra Investor is chosen. */}
          {!projectType && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {t("projects.form.typePickFirst", {
                defaultValue:
                  "Choose the project type above to see how the capital is funded and how the returns are split.",
              })}
            </p>
          )}
          {isClubLevel && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {t("projects.form.typeClubCapitalNote", {
                defaultValue:
                  "Club Level: every member funds by shares, and returns follow the category rules in Settings → Financial. There is no contract percentage on a club project.",
              })}
            </p>
          )}
        </ERPFormSection>

        {/* Section 2b: the Project Level Member CONTRACT (Extra Investor only).
            Its own section, above the club shareholders, because these members
            are not shareholders: they fund a percentage of the budget that is
            agreed here and never typed per person, and every number under this
            field is DERIVED from it (§2 D3, §6.1). */}
        {isExtraInvestor && (
          <ERPFormSection title={t("projects.form.pmSection", { defaultValue: "Project Level Members" })}>
            <ERPFormField
              label={t("projects.form.pmPercentContract", {
                defaultValue: "Contract — Project Level Members' share of the budget (%)",
              })}
              error={pmFieldError ?? undefined}
            >
              <div className="max-w-[220px]">
                <NumericInput
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  aria-invalid={pmFieldError ? true : undefined}
                  placeholder="0.00"
                  value={pmPercent}
                  onChange={(e) => {
                    setPmPercent(e.target.value);
                    // Editing the field supersedes the last server refusal — the
                    // derived amounts below recompute on the same keystroke.
                    setPmServerError(null);
                  }}
                  disabled={capitalLocked}
                  className={`w-full px-3 py-2 text-xs font-mono bg-card border text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors disabled:opacity-60 ${
                    pmFieldError ? "border-rose-400 dark:border-rose-700" : "border-border/80"
                  }`}
                />
              </div>
              {/* The two numbers the percentage actually buys, derived with the
                  server's own helpers so a chip and a ledger row cannot differ. */}
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-mono">
                <span className="px-2 py-1 rounded-lg bg-primary/10 text-primary border border-primary/20 rounded-lg">
                  {t("projects.form.pmContractChip", {
                    amount: fm(contractCents / 100),
                    defaultValue: `Contract ${fm(contractCents / 100)}`,
                  })}
                </span>
                {pmRowIds.length > 0 && contractCents > 0 && (
                  <span className="px-2 py-1 rounded-lg bg-primary/5 text-primary border border-primary/20 font-mono">
                    {t("projects.form.pmEachChip", {
                      each: fm((contractByPm.get(pmRowIds[0] ?? "") ?? 0) / 100),
                      count: String(pmRowIds.length),
                      defaultValue: `${fm((contractByPm.get(pmRowIds[0] ?? "") ?? 0) / 100)} per member ({{count}})`,
                    })}
                  </span>
                )}
                <span
                  className={`px-2 py-1 rounded-lg border ${
                    overBudget
                      ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800"
                      : "bg-muted/40 text-muted-foreground border-border/70"
                  }`}
                >
                  {t("projects.form.clubCeilingChip", {
                    ceiling: fm(clubCeilingCents / 100),
                    defaultValue: `Board + Shareholders may fund up to ${fm(clubCeilingCents / 100)}`,
                  })}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {t("projects.form.pmPercentContractHint", {
                  defaultValue:
                    "One percentage for the project, not per member. Every Project Level Member obligation below is derived from it, and the same figure is what their returns follow.",
                })}
              </p>
            </ERPFormField>

            <div className="space-y-2 mt-3">
              {pmRows.length === 0 ? (
                <div className="p-4 border border-dashed border-border/80 rounded-xl text-center text-xs text-muted-foreground">
                  {t("projects.form.noPmRows", {
                    defaultValue:
                      "No Project Level Members yet. Add one to fund the contract against a member and a deposit fund.",
                  })}
                </div>
              ) : (
                pmRows.map((row, index) => {
                  const member = members.find((m) => m.id === row.memberId);
                  const obligationCents = contractByPm.get(row.memberId) ?? 0;
                  const balanceCents = toCents(
                    Number(member?.totalContributed || 0) + (committedByMember.get(row.memberId) ?? 0),
                  );
                  const shortByContract = Boolean(row.memberId) && balanceCents < obligationCents;
                  const takenElsewhere = new Set([
                    ...pmRows.filter((_, i) => i !== index).map((r) => r.memberId),
                    ...shareholders.map((s) => s.memberId),
                  ]);
                  const rowOptions = projectMemberOptions.filter((o) => !takenElsewhere.has(o.value));
                  return (
                    <div
                      key={index}
                      className={`p-3 bg-card border rounded-xl space-y-2 ${
                        shortByContract ? "border-rose-300 dark:border-rose-900 bg-rose-50/20" : "border-border/80"
                      }`}
                    >
                      <div className="grid grid-cols-12 gap-3 items-center">
                        <div className="col-span-6">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
                            {t("projects.shareholders.sourceFund", { defaultValue: "Source Deposit Fund" })}
                          </label>
                          <AppDropdown
                            options={sourceOptionsForRow(row.sourceFundId)}
                            value={row.sourceFundId || null}
                            disabled={capitalLocked}
                            onChange={(val) => handlePmRowChange(index, "sourceFundId", val || "")}
                            placeholder={t("projects.shareholders.selectSourceFund", {
                              defaultValue: "Select fund to draw from...",
                            })}
                          />
                        </div>
                        <div className="col-span-6">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
                            {t("projects.shareholderMember", { defaultValue: "Member" })}
                          </label>
                          <AppDropdown
                            options={rowOptions}
                            value={row.memberId || null}
                            disabled={capitalLocked}
                            onChange={(val) => handlePmRowChange(index, "memberId", val || "")}
                            placeholder={t("projects.form.selectPmMember", {
                              defaultValue: "Select a Project Level Member...",
                            })}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-12 gap-3 items-center">
                        <div className="col-span-3">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
                            {t("projects.form.contractCapital", { defaultValue: "Contract capital" })}
                          </label>
                          <div className="px-2.5 py-2 text-xs font-mono font-semibold text-foreground bg-muted/30 border border-border/60 rounded-xl">
                            {fm(obligationCents / 100)}
                          </div>
                        </div>
                        <div className="col-span-3">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
                            {t("projects.sharesLabel", { defaultValue: "Shares" })}
                          </label>
                          <div className="px-2.5 py-2 text-xs font-mono text-muted-foreground bg-muted/30 border border-border/60 rounded-xl">
                            {t("projects.form.noShares", { defaultValue: "—" })}
                          </div>
                        </div>
                        {!capitalLocked && (
                          <div className="col-span-6 flex justify-end pt-5">
                            <Button
                              variant="ghost"
                              size="sm"
                              type="button"
                              icon={Trash2}
                              onClick={() => handleRemovePmRow(index)}
                              className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 h-8 w-8 p-0"
                            />
                          </div>
                        )}
                      </div>
                      {shortByContract && (
                        <div className="text-[11px] text-rose-600 dark:text-rose-400 flex items-center gap-1 font-medium pt-1">
                          <AlertCircle className="w-3.5 h-3.5" />
                          <span>
                            {t("projects.form.pmDepositShort", {
                              available: fm(balanceCents / 100),
                              defaultValue: `Deposit balance is below this contract (Available: ${fm(balanceCents / 100)})`,
                            })}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              {!capitalLocked && (
                <Button variant="outline" size="sm" icon={Plus} type="button" onClick={handleAddPmRow}>
                  {t("projects.form.addPmMember", { defaultValue: "Add Project Level Member" })}
                </Button>
              )}
            </div>
          </ERPFormSection>
        )}

        {/* Section 3: Fund Management (Link vs Create Dedicated) */}
        <ERPFormSection title={t("projects.fundStrategy", { defaultValue: "Fund Management" })}>
          <div className="space-y-3">
            <div className="flex items-center gap-4 text-xs font-medium">
              <label className="flex items-center gap-2 cursor-pointer text-foreground">
                <input
                  type="radio"
                  name="fundStrategy"
                  checked={fundStrategy === "linkExisting"}
                  onChange={() => setFundStrategy("linkExisting")}
                  className="text-primary focus:ring-primary h-3.5 w-3.5"
                />
                <span>{t("projects.funds.linkExisting", { defaultValue: "Link Existing Fund" })}</span>
              </label>

              {!initialData && (
                <label className="flex items-center gap-2 cursor-pointer text-foreground">
                  <input
                    type="radio"
                    name="fundStrategy"
                    checked={fundStrategy === "createNew"}
                    onChange={() => setFundStrategy("createNew")}
                    className="text-primary focus:ring-primary h-3.5 w-3.5"
                  />
                  <span>{t("projects.funds.createDedicated", { defaultValue: "Create New Dedicated Fund" })}</span>
                </label>
              )}
            </div>

            {fundStrategy === "linkExisting" ? (
              <ERPFormField label={t("projects.linkedFund", { defaultValue: "Source / Linked Fund" })}>
                <AppDropdown
                  options={fundOptions}
                  value={selectedFundId}
                  disabled={capitalLocked}
                  onChange={(val) => {
                    setSelectedFundId(val);
                    // §5: the destination can no longer be a source, so any row
                    // drawing from it is reset rather than left holding a value
                    // the server would reject.
                    if (val) {
                      setShareholders((prev) =>
                        prev.map((row) => (row.sourceFundId === val ? { ...row, sourceFundId: "", memberId: "" } : row)),
                      );
                    }
                  }}
                  placeholder={t("projects.selectFund", { defaultValue: "Select fund to link..." })}
                />
              </ERPFormField>
            ) : (
              <ERPFormField label={t("projects.funds.newFundName", { defaultValue: "Dedicated Fund Name *" })}>
                <div className="relative">
                  <input
                    type="text"
                    placeholder={title ? `${title} Fund` : t("projects.funds.newFundPlaceholder", { defaultValue: "e.g. Commercial Plaza Fund" })}
                    value={newFundName}
                    onChange={(e) => setNewFundName(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
                  />
                </div>
              </ERPFormField>
            )}
          </div>
        </ERPFormSection>

        {/* Section 4: Timeline & Dates */}
        <ERPFormSection title={t("projects.timeline", { defaultValue: "Timeline & Dates" })}>
          <ERPFormGrid cols={3}>
            <ERPFormField label={t("projects.startDate", { defaultValue: "Start Date *" })}>
              <ERPDatePicker
                value={startDate || null}
                onChange={(iso) => setStartDate(iso || "")}
                displayFormat={dateFormat}
                placeholder={t("projects.startDate", { defaultValue: "Start Date" })}
              />
            </ERPFormField>

            <ERPFormField label={t("projects.completionDate", { defaultValue: "Estimated Completion Date" })}>
              <ERPDatePicker
                value={completionDate || null}
                onChange={(iso) => setCompletionDate(iso || "")}
                displayFormat={dateFormat}
                placeholder={t("projects.completionDate", { defaultValue: "Estimated Completion Date" })}
              />
            </ERPFormField>

            <ERPFormField label={t("projects.status", { defaultValue: "Lifecycle Status" })}>
              <AppDropdown
                options={statusOptions}
                value={status}
                onChange={(val) => setStatus(val || "In Progress")}
                placeholder={t("projects.selectStatusPlaceholder", { defaultValue: "Select status..." })}
              />
            </ERPFormField>
          </ERPFormGrid>
        </ERPFormSection>

        {/* Section 5: Project Shareholders & Equity Allocation (Option A).
            Same editor on create and edit; locked once the ledger has moved. */}
        {(
          <ERPFormSection title={t("projects.shareholders.title", { defaultValue: "Project Shareholders & Equity Ownership" })}>
            <div className="space-y-3">
              {capitalLocked && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-300">
                  <Lock className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="font-medium">
                    {t("projects.shareholders.capitalLockedNote", {
                      defaultValue: "Locked: this project already has earnings or expenses recorded, so its shareholders, shares and source funds can no longer be changed.",
                    })}
                  </span>
                </div>
              )}
              {/* Option A Policy Banner */}
              <div className="p-3 bg-muted/40 border border-border/80 rounded-xl flex items-start gap-2.5 text-xs text-muted-foreground">
                <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-foreground">
                    {t("projects.shareholders.tenantShareValue", {
                      value: fm(tenantShareValue),
                      defaultValue: `Tenant Share Value: ${fm(tenantShareValue)} per share`,
                    })}
                  </p>
                  <p className="text-[11px] leading-relaxed">
                    {capitalLocked
                      ? t("projects.shareholders.optionALockedNote", {
                          defaultValue: "Recorded allocation. Changing it would strand the postings already made against this capital.",
                        })
                      : t("projects.shareholders.optionANote", {
                          defaultValue:
                            "Option A Active: On project creation, this capital will be deducted from each member's existing deposit account and transferred into the project fund.",
                        })}
                  </p>
                </div>
              </div>

              {/* Shareholder Rows */}
              {shareholders.length === 0 ? (
                <div className="p-4 border border-dashed border-border/80 rounded-xl text-center text-xs text-muted-foreground">
                  <p>{t("projects.shareholders.noShareholders", { defaultValue: "No shareholders assigned to this project yet." })}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {t("projects.shareholders.addMembersHint", {
                      defaultValue: "Add members to distribute project shares and auto-deduct required capital from their deposit balance.",
                    })}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {shareholders.map((row, index) => {
                    const selectedMember = members.find((m) => m.id === row.memberId);
                    const memberDeposit =
                      Number(selectedMember?.totalContributed || 0) + (committedByMember.get(row.memberId) ?? 0);
                    const requiredCapital = (row.shares || 0) * tenantShareValue;
                    const isInsufficient = selectedMember && memberDeposit < requiredCapital;
                    // A member already picked in another shareholder row cannot be
                    // chosen here again (duplicates are rejected on submit + server),
                    // but this row's own selection stays visible.
                    const takenElsewhere = new Set(
                      shareholders
                        .filter((_, i) => i !== index)
                        .map((s) => s.memberId)
                        .filter(Boolean),
                    );
                    const rowMemberOptions = shareholderMemberOptions.filter((o) => !takenElsewhere.has(o.value));

                    return (
                      <div
                        key={index}
                        className={`p-3 bg-card border rounded-xl space-y-2 transition-colors ${
                          isInsufficient ? "border-rose-300 dark:border-rose-900 bg-rose-50/20" : "border-border/80"
                        }`}
                      >
                        {/* Parent → child order (§5): the source fund is chosen
                            first, then the member whose capital is invested. */}
                        <div className="grid grid-cols-12 gap-3 items-center">
                          <div className="col-span-6">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
                              {t("projects.shareholders.sourceFund", { defaultValue: "Source Deposit Fund" })}
                            </label>
                            <AppDropdown
                              options={sourceOptionsForRow(row.sourceFundId)}
                              value={row.sourceFundId || null}
                              onChange={(val) => handleShareholderChange(index, "sourceFundId", val || "")}
                              disabled={capitalLocked}
                              placeholder={t("projects.shareholders.selectSourceFund", { defaultValue: "Select fund to draw from..." })}
                            />
                          </div>

                          <div className="col-span-6">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
                              {t("projects.shareholderMember", { defaultValue: "Member" })}
                            </label>
                            <AppDropdown
                              options={rowMemberOptions}
                              value={row.memberId || null}
                              onChange={(val) => handleShareholderChange(index, "memberId", val || "")}
                              disabled={capitalLocked}
                              placeholder={t("projects.shareholders.selectMember", { defaultValue: "Select member..." })}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-12 gap-3 items-center">
                          <div className="col-span-3">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
                              {t("projects.sharesLabel", { defaultValue: "Shares" })}
                            </label>
                            <NumericInput
                              type="number"
                              min="1"
                              step="1"
                              value={row.shares}
                              disabled={capitalLocked}
                              onChange={(e) =>
                                handleShareholderChange(index, "shares", Math.max(1, parseInt(e.target.value) || 1))
                              }
                              className="w-full px-2.5 py-2 text-xs font-mono bg-card border border-border/80 text-foreground rounded-xl outline-none focus:border-primary disabled:opacity-60 disabled:cursor-not-allowed"
                            />
                          </div>

                          <div className="col-span-3">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
                              {t("projects.shareholders.capital", { defaultValue: "Required Capital" })}
                            </label>
                            <div className="px-2.5 py-2 text-xs font-mono font-semibold text-foreground bg-muted/30 border border-border/60 rounded-xl">
                              {fm(requiredCapital)}
                            </div>
                          </div>

                          {!capitalLocked && (
                            <div className="col-span-6 flex justify-end pt-5">
                              <Button
                                variant="ghost"
                                size="sm"
                                type="button"
                                icon={Trash2}
                                onClick={() => handleRemoveShareholder(index)}
                                className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 h-8 w-8 p-0"
                              />
                            </div>
                          )}
                        </div>

                        {/* Balance Warning / Status */}
                        {!capitalLocked && isInsufficient && (
                          <div className="text-[11px] text-rose-600 dark:text-rose-400 flex items-center gap-1 font-medium pt-1">
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>
                              {t("projects.shareholders.insufficientDeposit", {
                                available: fm(memberDeposit),
                                defaultValue: `Insufficient deposit balance (Available: ${fm(memberDeposit)})`,
                              })}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                {!capitalLocked && (
                  <Button
                    variant="outline"
                    size="sm"
                    icon={Plus}
                    type="button"
                    onClick={handleAddShareholder}
                  >
                    {t("projects.shareholders.add", { defaultValue: "Add Shareholder" })}
                  </Button>
                )}

                {shareholders.length > 0 && (
                  <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground">
                    <span>
                      {t("projects.shareholders.totalProjectShares", { defaultValue: "Total Shares" })}:{" "}
                      <strong className="text-foreground">{totalShares}</strong>
                    </span>
                    <span>
                      {t("projects.shareholders.totalMemberCapital", { defaultValue: "Total Capital" })}:{" "}
                      <strong className="text-foreground">{fm(totalShareholderCapital)}</strong>
                    </span>
                  </div>
                )}
              </div>

              {overBudget && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl flex items-start gap-2 text-[11px] text-rose-700 dark:text-rose-300">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                  <span className="font-medium">
                    {t("projects.validation.capitalExceedsBudget", {
                      invested: fm(totalShareholderCapital),
                      budget: fm(numBudgetInput),
                      defaultValue: `Total shareholder investment (${fm(totalShareholderCapital)}) cannot exceed the project budget (${fm(numBudgetInput)}).`,
                    })}
                  </span>
                </div>
              )}
            </div>
          </ERPFormSection>
        )}

        </>)}

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-border">
          {review ? (
            <>
              {/* Step two: Back keeps every keystroke (the form state was never
                  torn down), Confirm posts exactly the reviewed payload. */}
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => setReview(null)}
                disabled={isSubmitting}
              >
                {t("projects.review.back", { defaultValue: "Back to editing" })}
              </Button>
              <Button variant="primary" size="sm" type="button" onClick={confirmReview} loading={isSubmitting}>
                {t("projects.review.confirm", { defaultValue: "Confirm & save" })}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" type="button" onClick={onClose} disabled={isSubmitting}>
                {t("common.cancel", { defaultValue: "Cancel" })}
              </Button>
              <Button variant="primary" size="sm" type="submit" loading={isSubmitting}>
                {t("projects.reviewButton", { defaultValue: "Review" })}
              </Button>
            </>
          )}
        </div>
      </form>
    </TopSheet>
  );
}
