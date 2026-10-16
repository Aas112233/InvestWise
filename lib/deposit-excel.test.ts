import type { Workbook, Worksheet } from "exceljs";
import { describe, expect, it } from "vitest";
import {
  MAX_TEMPLATE_BYTES,
  XLSX_MIME,
  buildDepositTemplate,
  readDepositTemplate,
  reviewDepositImport,
  type LiveMember,
  type TemplateLabels,
  type TemplateMember,
} from "./deposit-excel";

const TENANT = "tenant-1";
const labels: TemplateLabels = {
  sheetName: "Deposits",
  instructionsSheetName: "Instructions",
  memberId: "Member ID",
  name: "Member Name",
  shares: "Shares",
  amount: "Amount (BDT)",
  instructionsTitle: "How to fill this template",
  instructions: ["Fill Amount only.", "Locked columns cannot change."],
  amountErrorTitle: "Invalid amount",
  amountError: "Enter a number.",
};
const ahmed: TemplateMember = { id: "m-1", memberId: "GV-001", name: "Ahmed Khan", shares: 3 };
const rahima: TemplateMember = { id: "m-2", memberId: "GV-002", name: "Rahima Begum", shares: 2 };
const karim: TemplateMember = { id: "m-3", memberId: "GV-003", name: "Karim Uddin", shares: 0 };
const members = [ahmed, rahima, karim];
const active = (m: TemplateMember): LiveMember => ({ ...m, status: "active" });
const live = members.map(active);

const loadExcel = async () => (await import("exceljs")).default;
const asFile = (data: ArrayBuffer | Uint8Array, name = "deposits.xlsx") =>
  new File([data as BlobPart], name, { type: XLSX_MIME });
const template = () => buildDepositTemplate({ members, shareValueCents: 100_000, tenantId: TENANT, labels });

function firstSheet(wb: Workbook): Worksheet {
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("workbook has no sheets");
  return ws;
}

async function edit(data: ArrayBuffer, mutate: (ws: Worksheet) => void): Promise<ArrayBuffer> {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  mutate(firstSheet(wb));
  return wb.xlsx.writeBuffer();
}

async function review(
  data: ArrayBuffer,
  opts: { members?: LiveMember[]; paid?: string[]; tenantId?: string } = {},
) {
  const parsed = await readDepositTemplate(asFile(data));
  return reviewDepositImport(parsed, {
    tenantId: opts.tenantId ?? TENANT,
    members: opts.members ?? live,
    alreadyPaid: new Set(opts.paid ?? []),
  });
}

const codes = (r: Awaited<ReturnType<typeof review>>) =>
  r.flagged.map((f) => [f.row, f.reasons.map((x) => x.code)]);

describe("bulk deposit Excel template", () => {
  it("round-trips with amounts prefilled as shares x share value", async () => {
    const r = await review(await template());
    expect(r.ready.map((x) => [x.key, x.memberId, x.amountCents])).toEqual([
      ["m-1", "GV-001", 300_000],
      ["m-2", "GV-002", 200_000],
    ]);
    expect(r.flagged).toEqual([]);
    expect(r.skipped).toBe(1);
    expect(r.totalCents).toBe(500_000);
  });

  it("locks the identity columns and leaves only Amount editable", async () => {
    const ExcelJS = await loadExcel();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await template());
    const ws = firstSheet(wb);
    expect(ws.getCell("D2").protection?.locked).toBe(false);
    expect(ws.getCell("A2").protection?.locked).not.toBe(false);
    expect(ws.getColumn(5).hidden).toBe(true);
    expect((ws as unknown as { sheetProtection?: { sheet?: boolean } }).sheetProtection?.sheet).toBe(true);
    expect(wb.getWorksheet("iw_meta")?.state).toBe("veryHidden");
  });

  it("flags edited locked details and names each changed field", async () => {
    const data = await edit(await template(), (ws) => {
      ws.getCell("B2").value = "Ahmed K";
      ws.getCell("C2").value = 9;
    });
    const r = await review(data);
    expect(r.ready.map((x) => x.memberId)).toEqual(["GV-002"]);
    expect(r.flagged).toHaveLength(1);
    expect(r.flagged[0]).toMatchObject({ row: 2, memberId: "GV-001", name: "Ahmed Khan", amountCents: 300_000 });
    expect(r.flagged[0]?.reasons).toEqual([
      {
        code: "changed",
        fields: [
          { field: "name", from: "Ahmed Khan", to: "Ahmed K" },
          { field: "shares", from: "3", to: "9" },
        ],
      },
    ]);
  });

  it("holds back rows added in the file and every copy of a duplicated member", async () => {
    const data = await edit(await template(), (ws) => {
      ws.addRow(["GV-009", "New Person", 1, 500]);
      ws.addRow(["GV-002", "Rahima Begum", 2, 700, "m-2"]);
    });
    const r = await review(data);
    expect(r.ready.map((x) => x.memberId)).toEqual(["GV-001"]);
    expect(codes(r)).toEqual([
      [3, ["duplicate"]],
      [5, ["notInTemplate"]],
      [6, ["duplicate"]],
    ]);
  });

  it("flags stale, inactive and missing members against live data", async () => {
    const r = await review(await template(), {
      members: [{ ...active(ahmed), name: "Ahmed Khan Chowdhury" }, { ...active(rahima), status: "inactive" }],
    });
    expect(r.ready).toEqual([]);
    expect(codes(r)).toEqual([
      [2, ["stale"]],
      [3, ["inactive"]],
    ]);

    const missing = await review(await template(), { members: [active(ahmed)] });
    expect(codes(missing)).toEqual([[3, ["missing"]]]);
  });

  it("applies the manual-entry amount rules", async () => {
    const data = await edit(await template(), (ws) => {
      ws.getCell("D2").value = 1234.567;
      ws.getCell("D3").value = -5;
      ws.getCell("D4").value = 20_000_000;
    });
    const r = await review(data);
    expect(r.ready).toEqual([]);
    expect(codes(r)).toEqual([
      [2, ["invalidAmount"]],
      [3, ["invalidAmount"]],
      [4, ["tooLarge"]],
    ]);
  });

  it("accepts plain text and cached formula results, skips blank and zero, rejects ambiguous text", async () => {
    const data = await edit(await template(), (ws) => {
      ws.getCell("D2").value = "1500.50";
      ws.getCell("D3").value = { formula: "2*1000", result: 2000 };
      ws.getCell("D4").value = 0;
    });
    const r = await review(data);
    expect(r.ready.map((x) => [x.memberId, x.amountCents])).toEqual([
      ["GV-001", 150_050],
      ["GV-002", 200_000],
    ]);
    expect(r.skipped).toBe(1);

    const bad = await edit(await template(), (ws) => {
      ws.getCell("D2").value = "1,500";
      ws.getCell("D3").value = { formula: "A1*2" };
    });
    expect(codes(await review(bad))).toEqual([
      [2, ["invalidAmount"]],
      [3, ["invalidAmount"]],
    ]);
  });

  it("flags members who already have a deposit for the chosen fund and month", async () => {
    const r = await review(await template(), { paid: ["m-2"] });
    expect(r.ready.map((x) => x.memberId)).toEqual(["GV-001"]);
    expect(codes(r)).toEqual([[3, ["alreadyPaid"]]]);
  });

  it("rejects files that are not this organization's template", async () => {
    await expect(review(await template(), { tenantId: "tenant-2" })).rejects.toMatchObject({ code: "wrongTenant" });

    const ExcelJS = await loadExcel();
    const plain = new ExcelJS.Workbook();
    plain.addWorksheet("Sheet1").addRow(["GV-001", "Ahmed Khan", 3, 3000]);
    await expect(readDepositTemplate(asFile(await plain.xlsx.writeBuffer()))).rejects.toMatchObject({
      code: "notTemplate",
    });
    await expect(readDepositTemplate(asFile(new Uint8Array([1, 2, 3])))).rejects.toMatchObject({ code: "unreadable" });
    await expect(readDepositTemplate(asFile(new Uint8Array([1]), "deposits.csv"))).rejects.toMatchObject({
      code: "notXlsx",
    });
    await expect(readDepositTemplate(asFile(new Uint8Array(MAX_TEMPLATE_BYTES + 1)))).rejects.toMatchObject({
      code: "tooLarge",
    });
  });
});
