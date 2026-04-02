/**
 * Centralized Excel Designer for InvestWise Reports
 * Provides a unified API for generating premium, branded Excel spreadsheets
 */
class ExcelDesigner {
    constructor(workbook) {
        this.workbook = workbook;
        this.worksheet = workbook.addWorksheet('Report');

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
                footer: "INVESTWISE ENTERPRISE SYSTEMS - STRATEGIC WEALTH INTELLIGENCE PROTOCOL"
            },
            bn: {
                period: "সময়কাল",
                generated: "তৈরি করা হয়েছে",
                allTime: "সর্বকালীন",
                footer: "ইনভেস্টওয়াইজ এন্টারপ্রাইজ সিস্টেমস - সম্পদ বুদ্ধিমত্তা প্রোটোকল"
            }
        };
    }

    /**
     * Initializes the report with a branded header
     */
    init(title, period, lang = 'en') {
        this.lang = lang;
        const t = this.translations[lang] || this.translations.en;

        // Merge header cells
        this.worksheet.mergeCells('A1:H1');
        const titleCell = this.worksheet.getCell('A1');
        titleCell.value = (title || 'FINANCIAL REPORT').toUpperCase();

        // Premium Styling for Title
        titleCell.font = { size: 22, bold: true, color: { argb: 'FFFFFFFF' } };
        titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: this.colors.dark } };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

        this.worksheet.getRow(1).height = 60;

        // Metadata Sub-header
        this.worksheet.mergeCells('A2:H2');
        const metaCell = this.worksheet.getCell('A2');
        const displayPeriod = (period === 'ALL TIME' || period === 'EX-DATA' || period === 'EX-DATA') ? t.allTime : period;
        metaCell.value = `${t.period}: ${displayPeriod}  |  ${t.generated}: ${new Date().toLocaleString().toUpperCase()}`;
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
        // Add Header Row
        const headerRow = this.worksheet.addRow(headers);
        headerRow.height = 30;

        headerRow.eachCell((cell) => {
            cell.font = { bold: true, color: { argb: this.colors.brand } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: this.colors.dark } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            this._applyBorder(cell);
        });

        // Add Data Rows
        rows.forEach((rowData, index) => {
            const row = this.worksheet.addRow(rowData);
            row.height = 25;

            row.eachCell((cell, colIndex) => {
                const isEven = index % 2 === 0;

                // Base Styling: Center align all text as per user request
                cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
                this._applyBorder(cell);

                // Zebra Striping
                if (!isEven) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F8F5' } };
                }

                // Conditional Formatting for Ledgers (Fund In/Fund Out columns)
                if (options.isLedger) {
                    if (colIndex === 5 && String(cell.value).startsWith('+')) {
                        cell.font = { color: { argb: this.colors.in.text }, bold: true };
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: this.colors.in.bg } };
                    }
                    if (colIndex === 6 && String(cell.value).startsWith('-')) {
                        cell.font = { color: { argb: this.colors.out.text }, bold: true };
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: this.colors.out.bg } };
                    }
                }

                // Numeric and Currency Alignment logic - override center if it's a value for better readability?
                // Actually the user asked for center, so I'll stick to center unless it's strictly numbers/LEDGER.
                const val = String(cell.value);
                if (val.includes('BDT')) {
                    cell.alignment = { horizontal: 'center', vertical: 'middle' }; // Keep centered as requested
                }
            });
        });

        // Auto-size columns to be slightly wider for better clarity
        this.worksheet.columns.forEach(column => {
            column.width = 25;
        });

        // Add Footer Branding
        this.worksheet.addRow([]);
        const footerText = this.translations[this.lang || 'en']?.footer || this.translations.en.footer;
        const footerRow = this.worksheet.addRow([footerText]);
        this.worksheet.mergeCells(`A${footerRow.number}:H${footerRow.number}`);
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
}

export default ExcelDesigner;
