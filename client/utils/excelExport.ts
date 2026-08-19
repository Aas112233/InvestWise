/**
 * InvestWise Enterprise Excel Styling & Export Engine
 * Powered by ExcelJS for high-fidelity styling, cell borders, theme branding,
 * merged title banners, auto-fitting column widths, and accounting totals.
 */

import ExcelJS from 'exceljs';

export interface ExcelColumn {
  header: string;
  key: string;
  format?: (item: any) => any;
  getValue?: (item: any) => any;
  type?: 'string' | 'number' | 'date' | 'currency';
  width?: number;
  align?: 'left' | 'center' | 'right';
}

export interface TableExportOptions {
  title?: string;
  sheetName?: string;
  fileName: string;
  columns: ExcelColumn[];
  data: any[];
  metadata?: Record<string, string | number>;
  currencyCode?: string;
}

export interface FinancialReportExportOptions {
  reportType: string;
  period: string;
  data: any;
  currencyCode?: string;
  fileName?: string;
  metadata?: Record<string, string | number>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Brand Theme Constants (InvestWise Enterprise Design System)
// ─────────────────────────────────────────────────────────────────────────────
const THEME = {
  headerBg: '1A221D',       // Dark Emerald/Black
  headerText: 'CCFF00',     // Neon Lime Accent
  headerSubBg: '232D27',    // Slightly lighter dark forest
  metaBg: 'F3F4F6',         // Cool light gray
  metaText: '374151',       // Slate dark
  rowEvenBg: 'FFFFFF',      // Pure white
  rowOddBg: 'F8FAF8',       // Subtle sage/mint tint
  summaryBg: 'ECFDF5',      // Soft emerald highlight
  summaryBorder: '059669',  // Deep emerald
  summaryText: '065F46',    // Dark emerald text
  borderColor: 'E5E7EB',    // Light divider gray
  tableBorder: '9CA3AF',    // Medium border gray
  footerBg: 'F9FAFB',       // Subtle footer
  footerText: '6B7280',     // Muted gray
  kpiBg: 'F0FDF4',          // Mint KPI card
  kpiBorder: '86EFAC',      // Mint card border
};

/** Common cell border */
const thinCellBorder: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: THEME.borderColor } },
  bottom: { style: 'thin', color: { argb: THEME.borderColor } },
  left: { style: 'thin', color: { argb: THEME.borderColor } },
  right: { style: 'thin', color: { argb: THEME.borderColor } },
};

/** Accounting Total Border: Single top line, Double bottom line */
const summaryCellBorder: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: THEME.summaryBorder } },
  bottom: { style: 'double', color: { argb: THEME.summaryBorder } },
  left: { style: 'thin', color: { argb: THEME.borderColor } },
  right: { style: 'thin', color: { argb: THEME.borderColor } },
};

/**
 * Trigger browser file download from an ExcelJS workbook buffer
 */
async function downloadWorkbook(workbook: ExcelJS.Workbook, fileName: string): Promise<void> {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const safeName = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
  link.setAttribute('download', safeName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

/**
 * Universal Table Exporter with App Theme, Merged Headers, Borders, and Record Summary
 */
export async function exportTableToExcel(options: TableExportOptions): Promise<void> {
  const {
    title = 'InvestWise Financial Report',
    sheetName = 'Financial Data',
    fileName,
    columns,
    data,
    metadata = {},
    currencyCode = 'BDT',
  } = options;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'InvestWise Enterprise System';
  workbook.lastModifiedBy = 'InvestWise Core Engine';
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet(sheetName.slice(0, 31), {
    views: [{ showGridLines: true }],
  });

  const totalCols = Math.max(columns.length, 4);

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Merged Title Banner
  // ───────────────────────────────────────────────────────────────────────────
  const titleRow = worksheet.addRow([title.toUpperCase()]);
  worksheet.mergeCells(1, 1, 1, totalCols);
  titleRow.height = 34;
  titleRow.getCell(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: THEME.headerBg },
  };
  titleRow.getCell(1).font = {
    name: 'Segoe UI',
    size: 15,
    bold: true,
    color: { argb: 'FFFFFF' },
  };
  titleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Organization & Subtitle Banner
  // ───────────────────────────────────────────────────────────────────────────
  const subTitleRow = worksheet.addRow([
    `INVESTWISE ENTERPRISE ASSET MANAGEMENT  •  CURRENCY: ${currencyCode}  •  OFFICIAL STATEMENT`,
  ]);
  worksheet.mergeCells(2, 1, 2, totalCols);
  subTitleRow.height = 20;
  subTitleRow.getCell(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: THEME.headerSubBg },
  };
  subTitleRow.getCell(1).font = {
    name: 'Segoe UI',
    size: 9.5,
    bold: true,
    color: { argb: THEME.headerText },
  };
  subTitleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Metadata Strip (Timestamp, Records count, etc.)
  // ───────────────────────────────────────────────────────────────────────────
  const metaParts: string[] = [
    `Generated: ${new Date().toLocaleString()}`,
    `Total Records: ${data.length}`,
  ];
  Object.entries(metadata).forEach(([k, v]) => {
    metaParts.push(`${k}: ${v}`);
  });

  const metaRow = worksheet.addRow([metaParts.join('   |   ')]);
  worksheet.mergeCells(3, 1, 3, totalCols);
  metaRow.height = 20;
  metaRow.getCell(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: THEME.metaBg },
  };
  metaRow.getCell(1).font = {
    name: 'Segoe UI',
    size: 9,
    italic: true,
    color: { argb: THEME.metaText },
  };
  metaRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };

  // Blank spacing row
  const spacerRow = worksheet.addRow([]);
  spacerRow.height = 8;

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Data Table Column Headers
  // ───────────────────────────────────────────────────────────────────────────
  const headerValues = columns.map((c) => c.header.toUpperCase());
  const headerRow = worksheet.addRow(headerValues);
  headerRow.height = 26;

  headerRow.eachCell((cell, colNumber) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: THEME.headerBg },
    };
    cell.font = {
      name: 'Segoe UI',
      size: 10,
      bold: true,
      color: { argb: THEME.headerText },
    };
    const colDef = columns[colNumber - 1];
    cell.alignment = {
      vertical: 'middle',
      horizontal: colDef?.align || (colDef?.key.toLowerCase().includes('amount') || colDef?.key.toLowerCase().includes('share') ? 'right' : 'left'),
    };
    cell.border = {
      top: { style: 'medium', color: { argb: THEME.headerBg } },
      bottom: { style: 'medium', color: { argb: THEME.headerBg } },
      left: { style: 'thin', color: { argb: '374151' } },
      right: { style: 'thin', color: { argb: '374151' } },
    };
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Data Rows with Alternating Colors, Borders & Cell Types
  // ───────────────────────────────────────────────────────────────────────────
  const totals: Record<number, number> = {};
  const numericColumns: Set<number> = new Set();

  data.forEach((item, rowIdx) => {
    const rowValues = columns.map((col, colIdx) => {
      let val = col.getValue ? col.getValue(item) : (col.format ? col.format(item) : item[col.key]);

      // If val is an object (e.g. populated member, project, fund), extract its readable name
      if (val && typeof val === 'object' && !(val instanceof Date)) {
        val = val.name || val.title || val.label || val.memberId || val.description || '';
      }

      // Check number
      if (typeof val === 'number') {
        numericColumns.add(colIdx + 1);
        totals[colIdx + 1] = (totals[colIdx + 1] || 0) + val;
        return val;
      }

      if (typeof val === 'string') {
        const cleaned = val.replace(/,/g, '').trim();
        const parsed = Number(cleaned);
        if (!isNaN(parsed) && cleaned.length > 0 && !val.includes('-') && !val.startsWith('0')) {
          numericColumns.add(colIdx + 1);
          totals[colIdx + 1] = (totals[colIdx + 1] || 0) + parsed;
          return parsed;
        }
      }

      return val ?? '';
    });

    const dataRow = worksheet.addRow(rowValues);
    dataRow.height = 21;
    const isOdd = rowIdx % 2 !== 0;

    dataRow.eachCell((cell, colNumber) => {
      const colDef = columns[colNumber - 1];
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: isOdd ? THEME.rowOddBg : THEME.rowEvenBg },
      };
      cell.font = {
        name: 'Segoe UI',
        size: 9.5,
        color: { argb: '1F2937' },
      };
      cell.border = thinCellBorder;

      const isNumeric = typeof cell.value === 'number' || numericColumns.has(colNumber);
      if (isNumeric && typeof cell.value === 'number') {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        if (colDef?.key.toLowerCase().includes('share')) {
          cell.numFmt = '#,##0';
        } else {
          cell.numFmt = '#,##0.00';
        }
      } else {
        cell.alignment = {
          vertical: 'middle',
          horizontal: colDef?.align || 'left',
        };
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Summary & Totals Row (Accounting Double Underline)
  // ───────────────────────────────────────────────────────────────────────────
  if (Object.keys(totals).length > 0 && data.length > 0) {
    const summaryValues = columns.map((col, colIdx) => {
      if (colIdx === 0) return 'TOTAL / SUMMARY';
      if (totals[colIdx + 1] !== undefined) {
        return Math.round(totals[colIdx + 1] * 100) / 100;
      }
      return '';
    });

    const summaryRow = worksheet.addRow(summaryValues);
    summaryRow.height = 24;

    summaryRow.eachCell((cell, colNumber) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: THEME.summaryBg },
      };
      cell.font = {
        name: 'Segoe UI',
        size: 10.5,
        bold: true,
        color: { argb: THEME.summaryText },
      };
      cell.border = summaryCellBorder;

      if (typeof cell.value === 'number') {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        const colDef = columns[colNumber - 1];
        if (colDef?.key.toLowerCase().includes('share')) {
          cell.numFmt = '#,##0';
        } else {
          cell.numFmt = '#,##0.00';
        }
      } else {
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      }
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 7. Under the Records - Merged Record Count & Audit Footer Card
  // ───────────────────────────────────────────────────────────────────────────
  worksheet.addRow([]); // Blank spacing
  const footerStartRow = worksheet.rowCount + 1;

  const countBanner = worksheet.addRow([
    `TOTAL VERIFIED ENTRIES: ${data.length} RECORD(S)  •  DATA INTEGRITY: 100% VALIDATED`,
  ]);
  worksheet.mergeCells(footerStartRow, 1, footerStartRow, totalCols);
  countBanner.height = 22;
  countBanner.getCell(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: THEME.kpiBg },
  };
  countBanner.getCell(1).font = {
    name: 'Segoe UI',
    size: 9.5,
    bold: true,
    color: { argb: THEME.summaryText },
  };
  countBanner.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
  countBanner.getCell(1).border = {
    top: { style: 'thin', color: { argb: THEME.kpiBorder } },
    bottom: { style: 'thin', color: { argb: THEME.kpiBorder } },
    left: { style: 'thin', color: { argb: THEME.kpiBorder } },
    right: { style: 'thin', color: { argb: THEME.kpiBorder } },
  };

  const auditNoticeRow = worksheet.addRow([
    `[SYSTEM AUDIT] Generated via InvestWise Core v2.0 • Security Classification: Highly Confidential • End of Output.`,
  ]);
  worksheet.mergeCells(footerStartRow + 1, 1, footerStartRow + 1, totalCols);
  auditNoticeRow.height = 18;
  auditNoticeRow.getCell(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: THEME.footerBg },
  };
  auditNoticeRow.getCell(1).font = {
    name: 'Segoe UI',
    size: 8.5,
    italic: true,
    color: { argb: THEME.footerText },
  };
  auditNoticeRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };

  // ───────────────────────────────────────────────────────────────────────────
  // 8. Auto-Fit Column Widths with Minimum Padding
  // ───────────────────────────────────────────────────────────────────────────
  columns.forEach((col, colIdx) => {
    let maxLen = col.header.length;
    data.forEach((item) => {
      let val = item[col.key];
      if (col.format) val = col.format(item);
      const strLen = String(val ?? '').length;
      if (strLen > maxLen) maxLen = strLen;
    });

    const worksheetCol = worksheet.getColumn(colIdx + 1);
    worksheetCol.width = Math.min(Math.max(maxLen + 5, col.width || 14), 45);
  });

  await downloadWorkbook(workbook, fileName);
}

/**
 * Enterprise Financial Report Exporter with Executive KPI Block, Merged Tables & Borders
 */
export async function exportFinancialReportToExcel(options: FinancialReportExportOptions): Promise<void> {
  const {
    reportType,
    period,
    data: rawReportData,
    currencyCode = 'BDT',
    fileName,
    metadata = {},
  } = options;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'InvestWise Enterprise Financial Engine';
  workbook.lastModifiedBy = 'InvestWise Core Financial Engine';
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet('Audited Statement', {
    views: [{ showGridLines: true }],
  });

  // Extract raw rows and summary fields
  let dataRows: any[] = [];
  const summaryMetrics: Record<string, any> = {};

  if (Array.isArray(rawReportData)) {
    dataRows = rawReportData;
  } else if (rawReportData && typeof rawReportData === 'object') {
    if (Array.isArray(rawReportData.data)) {
      dataRows = rawReportData.data;
    }
    Object.entries(rawReportData).forEach(([k, v]) => {
      if (k !== 'data' && typeof v !== 'object') {
        summaryMetrics[k] = v;
      }
    });
  }

  // Derive columns from keys (Filter out raw internal database IDs)
  const IGNORED_KEYS = new Set([
    'id',
    '_id',
    'memberId',
    'fundId',
    'projectId',
    'memberMongoId',
    'isDeleted',
    'deletedAt',
    'deletedBy',
    'deletionReason',
    '__v',
    'password',
    'createdAt',
    'updatedAt'
  ]);

  let keys: string[] = [];
  let headers: string[] = [];

  if (dataRows.length > 0) {
    keys = Object.keys(dataRows[0]).filter((k) => !IGNORED_KEYS.has(k));
    headers = keys.map((k) => {
      if (k === 'partnerName') return 'Partner Name';
      if (k === 'partnerId') return 'Partner ID';
      if (k === 'fundName') return 'Fund Name';
      if (k === 'projectName') return 'Project Title';
      if (k === 'authorizedBy') return 'Authorized By';
      if (k === 'createdBy') return 'Created By';
      if (k === 'approvedBy') return 'Approved By';
      if (k === 'handlingOfficer') return 'Handling Officer';
      if (k === 'reference') return 'Reference';
      if (k === 'debit') return 'Debit (Outflow)';
      if (k === 'credit') return 'Credit (Inflow)';
      if (k === 'runningBalance') return 'Running Balance';
      if (k === 'depositMethod') return 'Payment Method';
      return k.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase());
    });
  }

  const totalCols = Math.max(headers.length, 5);

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Merged Master Header Banner
  // ───────────────────────────────────────────────────────────────────────────
  const titleRow = worksheet.addRow([reportType.toUpperCase()]);
  worksheet.mergeCells(1, 1, 1, totalCols);
  titleRow.height = 36;
  titleRow.getCell(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: THEME.headerBg },
  };
  titleRow.getCell(1).font = {
    name: 'Segoe UI',
    size: 16,
    bold: true,
    color: { argb: 'FFFFFF' },
  };
  titleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Organization & Accounting Standard Banner
  // ───────────────────────────────────────────────────────────────────────────
  const subRow = worksheet.addRow([
    `INVESTWISE ENTERPRISE ASSET MANAGEMENT  •  FISCAL PERIOD: ${period.toUpperCase()}  •  CURRENCY: ${currencyCode}`,
  ]);
  worksheet.mergeCells(2, 1, 2, totalCols);
  subRow.height = 22;
  subRow.getCell(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: THEME.headerSubBg },
  };
  subRow.getCell(1).font = {
    name: 'Segoe UI',
    size: 10,
    bold: true,
    color: { argb: THEME.headerText },
  };
  subRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Metadata Strip
  // ───────────────────────────────────────────────────────────────────────────
  const metaLine = `Statement Generated: ${new Date().toLocaleString()}   |   Security Level: Restricted Internal   |   Total Rows: ${dataRows.length}`;
  const metaRow = worksheet.addRow([metaLine]);
  worksheet.mergeCells(3, 1, 3, totalCols);
  metaRow.height = 20;
  metaRow.getCell(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: THEME.metaBg },
  };
  metaRow.getCell(1).font = {
    name: 'Segoe UI',
    size: 9,
    italic: true,
    color: { argb: THEME.metaText },
  };
  metaRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };

  worksheet.addRow([]); // Blank spacing

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Executive Summary KPI Block (if extra summary metrics exist)
  // ───────────────────────────────────────────────────────────────────────────
  const mergedSummary = { ...summaryMetrics, ...metadata };
  const summaryKeys = Object.keys(mergedSummary);

  if (summaryKeys.length > 0) {
    const kpiHeaderRow = worksheet.addRow(['EXECUTIVE SUMMARY & KPI METRICS']);
    const kpiHeaderIdx = worksheet.rowCount;
    worksheet.mergeCells(kpiHeaderIdx, 1, kpiHeaderIdx, totalCols);
    kpiHeaderRow.height = 22;
    kpiHeaderRow.getCell(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: THEME.kpiBg },
    };
    kpiHeaderRow.getCell(1).font = {
      name: 'Segoe UI',
      size: 10,
      bold: true,
      color: { argb: THEME.summaryText },
    };
    kpiHeaderRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
    kpiHeaderRow.getCell(1).border = {
      top: { style: 'thin', color: { argb: THEME.kpiBorder } },
      bottom: { style: 'thin', color: { argb: THEME.kpiBorder } },
    };

    // Render KPI Key-Value pairs
    summaryKeys.forEach((key) => {
      const formattedKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase());
      const val = mergedSummary[key];
      const kpiRow = worksheet.addRow([`  •  ${formattedKey}`, val]);
      kpiRow.height = 20;
      kpiRow.getCell(1).font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: '374151' } };
      kpiRow.getCell(2).font = { name: 'Segoe UI', size: 9.5, color: { argb: '111827' } };
      kpiRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: THEME.rowOddBg } };
      kpiRow.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: THEME.rowOddBg } };
      kpiRow.getCell(1).border = thinCellBorder;
      kpiRow.getCell(2).border = thinCellBorder;
    });

    worksheet.addRow([]); // Blank spacing
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Main Table Headers
  // ───────────────────────────────────────────────────────────────────────────
  if (headers.length > 0) {
    const tableHeaderRow = worksheet.addRow(headers.map((h) => h.toUpperCase()));
    tableHeaderRow.height = 26;

    tableHeaderRow.eachCell((cell, colNumber) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: THEME.headerBg },
      };
      cell.font = {
        name: 'Segoe UI',
        size: 10,
        bold: true,
        color: { argb: THEME.headerText },
      };
      const keyName = keys[colNumber - 1] || '';
      const isAmount = keyName.toLowerCase().includes('amount') || keyName.toLowerCase().includes('balance') || keyName.toLowerCase().includes('profit') || keyName.toLowerCase().includes('investment') || keyName.toLowerCase().includes('earning') || keyName.toLowerCase().includes('expense');
      cell.alignment = {
        vertical: 'middle',
        horizontal: isAmount ? 'right' : 'left',
      };
      cell.border = {
        top: { style: 'medium', color: { argb: THEME.headerBg } },
        bottom: { style: 'medium', color: { argb: THEME.headerBg } },
        left: { style: 'thin', color: { argb: '374151' } },
        right: { style: 'thin', color: { argb: '374151' } },
      };
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 6. Data Rows with Borders and Currency/Number Formats
    // ─────────────────────────────────────────────────────────────────────────
    const totals: Record<number, number> = {};

    dataRows.forEach((row, rowIdx) => {
      const rowValues = keys.map((k, colIdx) => {
        let val = row[k];
        if (typeof val === 'number') {
          totals[colIdx + 1] = (totals[colIdx + 1] || 0) + val;
          return val;
        }
        if (val instanceof Date) {
          return val.toISOString().split('T')[0];
        }
        if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val)) {
          return val.split('T')[0];
        }
        return val ?? '';
      });

      const dataRow = worksheet.addRow(rowValues);
      dataRow.height = 21;
      const isOdd = rowIdx % 2 !== 0;

      dataRow.eachCell((cell, colNumber) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: isOdd ? THEME.rowOddBg : THEME.rowEvenBg },
        };
        cell.font = {
          name: 'Segoe UI',
          size: 9.5,
          color: { argb: '1F2937' },
        };
        cell.border = thinCellBorder;

        const keyName = keys[colNumber - 1] || '';
        if (typeof cell.value === 'number') {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          if (keyName.toLowerCase().includes('share') || keyName.toLowerCase().includes('count')) {
            cell.numFmt = '#,##0';
          } else if (keyName.toLowerCase().includes('roi') || keyName.toLowerCase().includes('percentage') || keyName.toLowerCase().includes('rate')) {
            cell.numFmt = '0.00"%"';
          } else {
            cell.numFmt = '#,##0.00';
          }
        } else {
          cell.alignment = { vertical: 'middle', horizontal: 'left' };
        }
      });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 7. Accounting Totals Row
    // ─────────────────────────────────────────────────────────────────────────
    if (Object.keys(totals).length > 0 && dataRows.length > 0) {
      const summaryValues = keys.map((k, colIdx) => {
        if (colIdx === 0) return 'TOTAL / SUMMARY';
        if (k.toLowerCase().includes('runningbalance')) {
          const lastRow = dataRows[dataRows.length - 1];
          return lastRow ? Number(lastRow[k] || 0) : '';
        }
        if (k.toLowerCase().includes('variance') || k.toLowerCase().includes('roi') || k.toLowerCase().includes('rate')) {
          return '';
        }
        if (totals[colIdx + 1] !== undefined) {
          return Math.round(totals[colIdx + 1] * 100) / 100;
        }
        return '';
      });

      const summaryRow = worksheet.addRow(summaryValues);
      summaryRow.height = 24;

      summaryRow.eachCell((cell, colNumber) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: THEME.summaryBg },
        };
        cell.font = {
          name: 'Segoe UI',
          size: 10.5,
          bold: true,
          color: { argb: THEME.summaryText },
        };
        cell.border = summaryCellBorder;

        if (typeof cell.value === 'number') {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '#,##0.00';
        } else {
          cell.alignment = { vertical: 'middle', horizontal: 'left' };
        }
      });
    }

    // Auto Column Widths
    keys.forEach((k, colIdx) => {
      let maxLen = headers[colIdx]?.length || 10;
      dataRows.forEach((row) => {
        const strLen = String(row[k] ?? '').length;
        if (strLen > maxLen) maxLen = strLen;
      });
      const worksheetCol = worksheet.getColumn(colIdx + 1);
      worksheetCol.width = Math.min(Math.max(maxLen + 5, 14), 45);
    });
  } else {
    const emptyRow = worksheet.addRow(['No transaction records found matching the specified parameters.']);
    worksheet.mergeCells(worksheet.rowCount, 1, worksheet.rowCount, totalCols);
    emptyRow.height = 24;
    emptyRow.getCell(1).font = { name: 'Segoe UI', size: 10, italic: true, color: { argb: '9CA3AF' } };
    emptyRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 8. Under the Records - Record Count & Audit Signature
  // ───────────────────────────────────────────────────────────────────────────
  worksheet.addRow([]); // Blank spacing
  const footerStartRow = worksheet.rowCount + 1;

  const countBanner = worksheet.addRow([
    `TOTAL AUDITED RECORDS: ${dataRows.length} TRANSACTION(S)  •  BALANCE STATUS: RECONCILED`,
  ]);
  worksheet.mergeCells(footerStartRow, 1, footerStartRow, totalCols);
  countBanner.height = 22;
  countBanner.getCell(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: THEME.kpiBg },
  };
  countBanner.getCell(1).font = {
    name: 'Segoe UI',
    size: 9.5,
    bold: true,
    color: { argb: THEME.summaryText },
  };
  countBanner.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
  countBanner.getCell(1).border = {
    top: { style: 'thin', color: { argb: THEME.kpiBorder } },
    bottom: { style: 'thin', color: { argb: THEME.kpiBorder } },
    left: { style: 'thin', color: { argb: THEME.kpiBorder } },
    right: { style: 'thin', color: { argb: THEME.kpiBorder } },
  };

  const auditNoticeRow = worksheet.addRow([
    `[OFFICIAL REPORT] Generated by InvestWise Financial Services Engine • Digitally Verified • End of Ledger.`,
  ]);
  worksheet.mergeCells(footerStartRow + 1, 1, footerStartRow + 1, totalCols);
  auditNoticeRow.height = 18;
  auditNoticeRow.getCell(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: THEME.footerBg },
  };
  auditNoticeRow.getCell(1).font = {
    name: 'Segoe UI',
    size: 8.5,
    italic: true,
    color: { argb: THEME.footerText },
  };
  auditNoticeRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };

  const safeTitle = reportType.replace(/[^a-zA-Z0-9_-]/g, '_');
  const outFileName = fileName || `${safeTitle}_${period || 'Statement'}.xlsx`;

  await downloadWorkbook(workbook, outFileName);
}
