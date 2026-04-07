/**
 * Centralized Excel Designer for InvestWise Reports
 * Provides a unified API for generating premium, branded Excel spreadsheets
 */
class ExcelDesigner {
    constructor(workbook) {
        this.workbook = workbook;
        this.worksheet = workbook.addWorksheet('Report');
        this.lastHeaderMergeRange = null;
        this.lastMetaMergeRange = null;

        // Brand Identity Tokens
        this.colors = {
            dark: 'FF1A221D',
            brand: 'FFBFF300',
            gray: 'FF64748B',
            light: 'FFF8FAFC',
            border: 'FFE2E8F0',
            in: { bg: 'FFC6EFCE', text: 'FF006100' },
            out: { bg: 'FFFFC7CE', text: 'FF9C0006' }
        };

        this.translations = {
            en: {
                period: "PERIOD",
                generated: "GENERATED",
                allTime: "ALL TIME",
                footer: "INVESTWISE ENTERPRISE SYSTEMS"
            },
            bn: {
                period: "সময়কাল",
                generated: "তৈরি করা হয়েছে",
                allTime: "সর্বকালীন",
                footer: "ইনভেস্টওয়াইজ এন্টারপ্রাইজ সিস্টেমস "
            }
        };
    }

    /**
    * Initializes the report with a branded header
    */
    init(title, period, lang = 'en') {
        this.lang = lang;
        const t = this.translations[lang] || this.translations.en;

        const titleCell = this.worksheet.getCell('A1');
        titleCell.value = (title || 'FINANCIAL REPORT').toUpperCase();

        // Premium Styling for Title
        titleCell.font = { size: 22, bold: true, color: { argb: 'FFFFFFFF' } };
        titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: this.colors.dark } };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

        this.worksheet.getRow(1).height = 60;

        // Metadata Sub-header
        const metaCell = this.worksheet.getCell('A2');
        const displayPeriod = (period === 'ALL TIME' || period === 'EX-DATA') ? t.allTime : period;
        metaCell.value = `${t.period}: ${displayPeriod} | ${t.generated}: ${new Date().toLocaleString().toUpperCase()}`;
        metaCell.font = { size: 9, bold: true, color: { argb: this.colors.gray } };
        metaCell.alignment = { horizontal: 'center', vertical: 'middle' };
        this.worksheet.getRow(2).height = 30;

        // Gap row
        this.worksheet.addRow([]);

        return this;
    }

    /**
    * Adds a standardized table with specific styling
    */
    addTable(headers, rows, options = {}) {
        const columnCount = Math.max(headers.length, 1);
        this._syncHeaderMerges(columnCount);

        // Add Header Row
        const headerRow = this.worksheet.addRow(headers);
        headerRow.height = 30;

        headerRow.eachCell((cell, colIndex) => {
            cell.font = { bold: true, color: { argb: this.colors.brand } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: this.colors.dark } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            this._applyBorder(cell);
            if (options.headerNotes?.[colIndex - 1]) {
                cell.note = options.headerNotes[colIndex - 1];
            }
        });

        if (options.freezeHeader !== false) {
            this.worksheet.views = [{
                state: 'frozen',
                ySplit: headerRow.number,
                xSplit: options.freezeColumns || 0
            }];
        }

        if (options.autoFilter !== false) {
            this.worksheet.autoFilter = {
                from: { row: headerRow.number, column: 1 },
                to: { row: headerRow.number, column: columnCount }
            };
        }

        const ledgerConfig = this._resolveLedgerConfig(headers, options);

        // Add Data Rows
        rows.forEach((rowData, index) => {
            const row = this.worksheet.addRow(rowData);
            row.height = 25;

            row.eachCell((cell, colIndex) => {
                const isEven = index % 2 === 0;
                const columnIndex = colIndex - 1;
                const header = headers[columnIndex];
                const columnFormat = this._resolveColumnFormat(header, cell.value, options, columnIndex);
                const horizontal = this._resolveAlignment(header, cell.value, options, columnIndex);

                cell.alignment = { horizontal, vertical: 'middle', wrapText: true };
                this._applyBorder(cell);

                // Zebra Striping
                if (options.zebra !== false && !isEven) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F8F5' } };
                }

                if (columnFormat) {
                    cell.numFmt = columnFormat;
                }

                if (typeof cell.value === 'number' && cell.value < 0) {
                    cell.font = { ...(cell.font || {}), color: { argb: this.colors.out.text }, bold: true };
                }

                // Conditional Formatting for Ledgers (Fund In/Fund Out columns)
                if (ledgerConfig.enabled) {
                    if (colIndex === ledgerConfig.creditColumn && this._isPositiveLedgerValue(cell.value)) {
                        cell.font = { ...(cell.font || {}), color: { argb: this.colors.in.text }, bold: true };
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: this.colors.in.bg } };
                    }
                    if (colIndex === ledgerConfig.debitColumn && this._isDebitLedgerValue(cell.value)) {
                        cell.font = { ...(cell.font || {}), color: { argb: this.colors.out.text }, bold: true };
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: this.colors.out.bg } };
                    }
                }
            });
        });

        this._applyColumnWidths(headers, rows, options);

        // Add Footer Branding
        this.worksheet.addRow([]);
        const footerText = this.translations[this.lang || 'en']?.footer || this.translations.en.footer;
        const footerRow = this.worksheet.addRow([footerText]);
        const footerMergeRange = `A${footerRow.number}:${this._columnLetter(columnCount)}${footerRow.number}`;
        this.worksheet.mergeCells(footerMergeRange);
        footerRow.getCell(1).font = { size: 8, italic: true, color: { argb: this.colors.gray } };
        footerRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
        this._applyBorder(footerRow.getCell(1)); // Apply border to footer as well

        return this;
    }

    _applyBorder(cell) {
        cell.border = {
            top: { style: 'thin', color: { argb: 'FFCBD5E1' } }, // Slate-300
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
        };
    }

    _syncHeaderMerges(columnCount) {
        const lastColumnLetter = this._columnLetter(columnCount);
        const titleRange = `A1:${lastColumnLetter}1`;
        const metaRange = `A2:${lastColumnLetter}2`;

        if (this.lastHeaderMergeRange && this.lastHeaderMergeRange !== titleRange) {
            this.worksheet.unMergeCells(this.lastHeaderMergeRange);
        }
        if (this.lastMetaMergeRange && this.lastMetaMergeRange !== metaRange) {
            this.worksheet.unMergeCells(this.lastMetaMergeRange);
        }

        if (columnCount > 1) {
            this.worksheet.mergeCells(titleRange);
            this.worksheet.mergeCells(metaRange);
        }

        this.lastHeaderMergeRange = titleRange;
        this.lastMetaMergeRange = metaRange;
    }

    _applyColumnWidths(headers, rows, options) {
        const minWidth = options.minColumnWidth || 12;
        const maxWidth = options.maxColumnWidth || 40;
        const explicitWidths = options.columnWidths || [];

        headers.forEach((header, index) => {
            const explicitWidth = explicitWidths[index];
            const width = explicitWidth || this._calculateColumnWidth(header, rows.map(row => row[index]), minWidth, maxWidth);
            this.worksheet.getColumn(index + 1).width = width;
        });
    }

    _calculateColumnWidth(header, values, minWidth, maxWidth) {
        const lengths = [header, ...values].map(value => this._estimateTextLength(value));
        const widest = Math.max(...lengths, minWidth);
        return Math.min(Math.max(widest + 2, minWidth), maxWidth);
    }

    _estimateTextLength(value) {
        if (value === null || value === undefined) return 0;
        if (value instanceof Date) return 12;
        const text = String(value);
        return Math.max(...text.split('\n').map(line => line.trim().length));
    }

    _resolveAlignment(header, value, options, columnIndex) {
        const manualAlignment = options.columnAlignments?.[columnIndex];
        if (manualAlignment) return manualAlignment;

        const normalizedHeader = String(header || '').toLowerCase();

        if (typeof value === 'number') return 'right';
        if (/description|name|title|source|memo|category|fund/.test(normalizedHeader)) return 'left';
        if (/amount|balance|investment|earning|expense|credit|debit|shares|roi|return|total|count/.test(normalizedHeader)) return 'right';
        if (/date|status|type|id|period/.test(normalizedHeader)) return 'center';

        return 'center';
    }

    _resolveColumnFormat(header, value, options, columnIndex) {
        const explicitFormat = options.columnFormats?.[columnIndex];
        if (explicitFormat) {
            return this._mapNamedFormat(explicitFormat);
        }

        const normalizedHeader = String(header || '').toLowerCase();
        if (value instanceof Date) return 'dd-mm-yyyy';
        if (typeof value !== 'number') return null;

        if (/%|roi|return|percentage/.test(normalizedHeader)) return '0.00%';
        if (/bdt|amount|balance|investment|earning|expense|credit|debit|contributed/.test(normalizedHeader)) return '#,##0.00';
        return '#,##0';
    }

    _mapNamedFormat(format) {
        const namedFormats = {
            currency: '#,##0.00',
            number: '#,##0',
            decimal: '#,##0.00',
            percent: '0.00%',
            date: 'dd-mm-yyyy'
        };

        return namedFormats[format] || format;
    }

    _resolveLedgerConfig(headers, options) {
        const headerLabels = headers.map(header => String(header || '').toLowerCase());
        const explicitLedger = options.ledger || {};
        const creditIndex = explicitLedger.creditColumnIndex ?? headerLabels.findIndex(label => /fund in|credit|inflow/.test(label));
        const debitIndex = explicitLedger.debitColumnIndex ?? headerLabels.findIndex(label => /fund out|debit|outflow/.test(label));

        return {
            enabled: options.isLedger || creditIndex !== -1 || debitIndex !== -1,
            creditColumn: creditIndex >= 0 ? creditIndex + 1 : -1,
            debitColumn: debitIndex >= 0 ? debitIndex + 1 : -1
        };
    }

    _isPositiveLedgerValue(value) {
        if (typeof value === 'number') return value > 0;
        return String(value || '').trim().startsWith('+');
    }

    _isDebitLedgerValue(value) {
        if (typeof value === 'number') return value > 0;
        const normalized = String(value || '').trim();
        return normalized.startsWith('-') || /^\+?\d/.test(normalized);
    }

    _columnLetter(columnNumber) {
        let dividend = columnNumber;
        let columnName = '';

        while (dividend > 0) {
            const modulo = (dividend - 1) % 26;
            columnName = String.fromCharCode(65 + modulo) + columnName;
            dividend = Math.floor((dividend - modulo) / 26);
        }

        return columnName || 'A';
    }
}

export default ExcelDesigner;
