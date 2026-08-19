import React, { useRef, useState, useEffect } from 'react';
import {
  Printer,
  Download,
  X,
  CheckCircle2,
  Copy,
  Check,
  QrCode,
  ShieldCheck
} from 'lucide-react';
import QRCode from 'qrcode';
import { VoucherDocument } from '../../utils/voucherGenerator';
import { useGlobalState } from '../../context/GlobalStateContext';
import './ReceiptStyles.css';

interface PrintableReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  voucher: VoucherDocument | null;
  appName?: string;
}

export const PrintableReceiptModal: React.FC<PrintableReceiptModalProps> = ({
  isOpen,
  onClose,
  voucher,
  appName,
}) => {
  const { companyName } = useGlobalState();
  const effectiveAppName = appName || companyName || 'InvestWise';
  const [copied, setCopied] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const printAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (voucher) {
      let payloadLines: string[] = [];

      if (voucher.distributionSchedule && voucher.distributionSchedule.length > 0) {
        payloadLines = [
          `=== ${effectiveAppName.toUpperCase()} CONSOLIDATED DIVIDEND ROLL ===`,
          `Roll Ref: ${voucher.voucherNo}`,
          `Date: ${voucher.date}`,
          `Pool / Venture: ${voucher.entityName}`,
          `Total Beneficiary Partners: ${voucher.distributionSchedule.length}`,
          `Total Floating Shares: ${voucher.breakdownSummary?.totalPoolShares || 0} Units`,
          `Payout Rate: ${voucher.currency} ${(voucher.breakdownSummary?.ratePerShare || 0).toFixed(4)} / Share`,
          `Total Disbursed: ${voucher.currency} ${Number(voucher.amount).toLocaleString('en-US')}`,
          `Status: ${voucher.status}`,
          `Verification Hash: ${voucher.verificationCode || 'SHA-VERIFIED'}`,
          `Issuer: ${effectiveAppName}`,
        ];
      } else if (voucher.breakdownSummary) {
        payloadLines = [
          `=== ${effectiveAppName.toUpperCase()} VERIFIED DIVIDEND SETTLEMENT ===`,
          `Receipt ID: ${voucher.voucherNo}`,
          `Type: ${voucher.voucherType} (${voucher.title})`,
          `Date: ${voucher.date}`,
          `Partner: ${voucher.entityName}${voucher.entityId ? ` (#${voucher.entityId})` : ''}`,
          `Member Shares: ${voucher.breakdownSummary.memberShares} Units (${voucher.breakdownSummary.memberShareRatio} of ${voucher.breakdownSummary.totalPoolShares} Units)`,
          `Dividend Rate: ${voucher.currency} ${voucher.breakdownSummary.ratePerShare.toFixed(2)} / Unit`,
          `Gross Profit Share: ${voucher.currency} ${voucher.breakdownSummary.grossProfit.toLocaleString('en-US')}`,
          `Losses / Deductions: ${voucher.currency} ${voucher.breakdownSummary.lossOrDeductions.toLocaleString('en-US')}`,
          `Net Money Disbursed: ${voucher.currency} ${voucher.breakdownSummary.netPayout.toLocaleString('en-US')}`,
          `Amount in Words: ${voucher.amountInWords}`,
          `Source: ${voucher.breakdownSummary.sourceName} (${voucher.breakdownSummary.sourceType})`,
          `Status: ${voucher.status}`,
          `Verification Hash: ${voucher.verificationCode || 'SHA-VERIFIED'}`,
          `Issuer: ${effectiveAppName}`,
        ];
      } else {
        const reason = voucher.notes || (voucher.items && voucher.items.length > 0 ? voucher.items.map(i => i.description).join(', ') : 'Financial Settlement');
        payloadLines = [
          `=== ${effectiveAppName.toUpperCase()} VERIFIED FINANCIAL RECEIPT ===`,
          `Receipt / Tx ID: ${voucher.voucherNo}`,
          `Type: ${voucher.voucherType} (${voucher.title})`,
          `Date: ${voucher.date}`,
          `Party: ${voucher.entityName}${voucher.entityId ? ` (#${voucher.entityId})` : ''}`,
          `Amount: ${voucher.currency} ${Number(voucher.amount).toLocaleString('en-US')}`,
          `Amount in Words: ${voucher.amountInWords}`,
          `Reason / Details: ${reason}`,
          `Fund: ${voucher.fundName || 'General Fund'} (${voucher.paymentMethod || 'Cash'})`,
          `Status: ${voucher.status}`,
          `Verification Hash: ${voucher.verificationCode || 'SHA-VERIFIED'}`,
          `Issuer: ${effectiveAppName}`,
        ];
      }

      QRCode.toDataURL(payloadLines.join('\n'), {
        width: 256,
        margin: 1,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
        errorCorrectionLevel: 'M',
      })
        .then((url: string) => setQrCodeUrl(url))
        .catch((err: any) => console.error('Failed to generate QR Code:', err));
    }
  }, [voucher, appName, effectiveAppName]);

  if (!isOpen || !voucher) return null;

  const handlePrint = () => {
    const printContent = printAreaRef.current;
    if (!printContent) {
      window.print();
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.setAttribute('title', 'Print Receipt Frame');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0px';
    iframe.style.height = '0px';
    iframe.style.border = 'none';
    iframe.style.zIndex = '-1000';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      window.print();
      return;
    }

    // Collect all stylesheets and style tags from parent
    let stylesHtml = '';
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((el) => {
      stylesHtml += el.outerHTML;
    });

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${voucher.title} - ${voucher.voucherNo}</title>
          ${stylesHtml}
          <style>
            @page {
              size: A4 portrait;
              margin: 12mm 15mm 12mm 15mm;
            }
            *, *::before, *::after {
              box-sizing: border-box;
            }
            body {
              background: #ffffff !important;
              color: #0f172a !important;
              margin: 0 !important;
              padding: 0 !important;
              font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            #printable-voucher-root {
              width: 100% !important;
              max-width: 100% !important;
              margin: 0 !important;
              padding: 24px !important;
              border: 1px solid #cbd5e1 !important;
              border-radius: 8px !important;
              box-shadow: none !important;
              background: #ffffff !important;
            }
            .page-break-avoid {
              break-inside: avoid;
              page-break-inside: avoid;
            }
          </style>
        </head>
        <body>
          ${printContent.outerHTML}
        </body>
      </html>
    `);
    doc.close();

    iframe.contentWindow?.focus();
    setTimeout(() => {
      try {
        iframe.contentWindow?.print();
      } catch (err) {
        console.error('Print failed:', err);
        window.print();
      } finally {
        setTimeout(() => {
          if (document.body.contains(iframe)) {
            document.body.removeChild(iframe);
          }
        }, 1500);
      }
    }, 250);
  };

  const handleCopySummary = () => {
    const summary = `${voucher.title} #${voucher.voucherNo}\n` +
      `Date: ${voucher.date}\n` +
      `Party: ${voucher.entityName} (${voucher.entityId || 'N/A'})\n` +
      `Amount: ${voucher.currency} ${Number(voucher.amount).toLocaleString()} (${voucher.amountInWords})\n` +
      `Fund: ${voucher.fundName || 'General'}`;
    
    navigator.clipboard.writeText(summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadPdf = async () => {
    setIsExportingPdf(true);
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      // Header Brand
      doc.setFillColor(37, 99, 235); // Brand Blue
      doc.rect(15, 14, 5, 14, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.setTextColor(15, 23, 42); // Slate 900
      doc.text(effectiveAppName.toUpperCase(), 24, 21);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text('Official Financial Receipt', 24, 26);

      // Voucher Number Badge (Top Right)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(37, 99, 235);
      doc.text(voucher.voucherNo, 195, 20, { align: 'right' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(`Date: ${voucher.date}`, 195, 25, { align: 'right' });
      doc.text(`Status: ${voucher.status.toUpperCase()}`, 195, 29, { align: 'right' });

      // Title Banner
      doc.setDrawColor(226, 232, 240);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(15, 34, 180, 10, 1.5, 1.5, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.text(voucher.title, 105, 40.5, { align: 'center' });

      // Metadata Box (2-column)
      doc.setDrawColor(226, 232, 240);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(15, 48, 180, 26, 1.5, 1.5, 'FD');

      // Left Column: Party Details
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text('PARTICIPANT / MEMBER', 20, 54);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.text(voucher.entityName, 20, 60);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      if (voucher.entityId) doc.text(`ID: #${voucher.entityId}`, 20, 65);
      if (voucher.entitySubtitle) doc.text(voucher.entitySubtitle, 20, 70);

      // Right Column: Fund & Method
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text('FUND & PAYMENT METHOD', 110, 54);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      doc.text(voucher.fundName || 'General Fund', 110, 60);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      doc.text(`Account: ${voucher.fundAccount || 'VAULT-01'}`, 110, 65);
      doc.text(`Method: ${voucher.paymentMethod || 'Cash'}`, 110, 70);

      // Render Schedule Table if multi-member roll
      if (voucher.distributionSchedule && voucher.distributionSchedule.length > 0) {
        let y = 80;
        doc.setFillColor(241, 245, 249);
        doc.rect(15, y, 180, 7, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.setTextColor(71, 85, 105);
        doc.text('#', 17, y + 4.8);
        doc.text('PARTNER NAME', 24, y + 4.8);
        doc.text('SHARES', 80, y + 4.8);
        doc.text('RATIO', 100, y + 4.8);
        doc.text('GROSS PROFIT', 130, y + 4.8, { align: 'right' });
        doc.text('DEDUCTIONS', 160, y + 4.8, { align: 'right' });
        doc.text(`NET PAYOUT (${voucher.currency})`, 192, y + 4.8, { align: 'right' });

        y += 7;
        voucher.distributionSchedule.forEach((row) => {
          if (y > 260) {
            doc.addPage();
            y = 20;
          }
          doc.setDrawColor(241, 245, 249);
          doc.line(15, y + 6, 195, y + 6);

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.5);
          doc.setTextColor(15, 23, 42);
          doc.text(String(row.sl), 17, y + 4.5);
          doc.setFont('helvetica', 'bold');
          doc.text(row.memberName.slice(0, 26), 24, y + 4.5);
          doc.setFont('helvetica', 'normal');
          doc.text(`${row.shares}`, 80, y + 4.5);
          doc.text(`${row.sharePercentage.toFixed(1)}%`, 100, y + 4.5);
          doc.setTextColor(16, 185, 129);
          doc.text(`+${Number(row.grossProfit).toFixed(2)}`, 130, y + 4.5, { align: 'right' });
          doc.setTextColor(100, 116, 139);
          doc.text(`${row.deductionsOrLoss > 0 ? `-${row.deductionsOrLoss}` : '0.00'}`, 160, y + 4.5, { align: 'right' });
          doc.setTextColor(37, 99, 235);
          doc.setFont('helvetica', 'bold');
          doc.text(`${Number(row.netPayout).toFixed(2)}`, 192, y + 4.5, { align: 'right' });

          y += 6.5;
        });

        // Totals
        y += 3;
        doc.setDrawColor(37, 99, 235);
        doc.setFillColor(239, 246, 255);
        doc.roundedRect(15, y, 180, 10, 1.5, 1.5, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(30, 58, 138);
        doc.text('TOTAL DISBURSED TO ALL MEMBERS:', 20, y + 6.5);
        doc.setFontSize(10);
        doc.setTextColor(37, 99, 235);
        doc.text(`${voucher.currency} ${Number(voucher.amount).toLocaleString('en-US')}`, 190, y + 6.5, { align: 'right' });

        y += 15;
      } else {
        // Individual Voucher / Receipt Layout
        let y = 80;

        if (voucher.breakdownSummary) {
          doc.setDrawColor(226, 232, 240);
          doc.setFillColor(248, 250, 252);
          doc.roundedRect(15, y, 180, 16, 1.5, 1.5, 'FD');

          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7);
          doc.setTextColor(100, 116, 139);
          doc.text('MEMBER SHARES & RATIO', 20, y + 5);
          doc.text('PAYOUT RATE / UNIT', 68, y + 5);
          doc.text('GROSS PROFIT', 115, y + 5);
          doc.text('NET MONEY RECEIVED', 160, y + 5);

          doc.setFontSize(8.5);
          doc.setTextColor(15, 23, 42);
          doc.text(`${voucher.breakdownSummary.memberShares} Units (${voucher.breakdownSummary.memberShareRatio})`, 20, y + 11);
          doc.setTextColor(37, 99, 235);
          doc.text(`${voucher.currency} ${voucher.breakdownSummary.ratePerShare.toFixed(2)}`, 68, y + 11);
          doc.setTextColor(16, 185, 129);
          doc.text(`+${voucher.currency} ${voucher.breakdownSummary.grossProfit.toLocaleString('en-US')}`, 115, y + 11);
          doc.setTextColor(37, 99, 235);
          doc.text(`${voucher.currency} ${voucher.breakdownSummary.netPayout.toLocaleString('en-US')}`, 160, y + 11);

          y += 22;
        }

        // Table Header
        doc.setFillColor(241, 245, 249);
        doc.rect(15, y, 180, 8, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(71, 85, 105);
        doc.text('DESCRIPTION', 20, y + 5.5);
        doc.text('QTY / SHARES', 130, y + 5.5);
        doc.text(`AMOUNT (${voucher.currency})`, 190, y + 5.5, { align: 'right' });

        // Table Rows
        y += 8;
        voucher.items.forEach((item) => {
          doc.setDrawColor(241, 245, 249);
          doc.line(15, y + 8, 195, y + 8);

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);
          doc.setTextColor(15, 23, 42);
          doc.text(item.description.slice(0, 55), 20, y + 5.5);

          if (item.quantity) {
            doc.text(String(item.quantity), 130, y + 5.5);
          }

          doc.setFont('helvetica', 'bold');
          doc.text(`${voucher.currency} ${Number(item.amount).toLocaleString('en-US')}`, 190, y + 5.5, { align: 'right' });
          y += 10;
        });

        // Total Box
        y += 4;
        doc.setDrawColor(37, 99, 235);
        doc.setFillColor(239, 246, 255);
        doc.roundedRect(15, y, 180, 13, 1.5, 1.5, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(30, 58, 138);
        doc.text('TOTAL AMOUNT:', 20, y + 8.5);

        doc.setFontSize(13);
        doc.setTextColor(37, 99, 235);
        doc.text(`${voucher.currency} ${Number(voucher.amount).toLocaleString('en-US')}`, 190, y + 9, { align: 'right' });

        // In Words
        y += 18;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text('IN WORDS:', 15, y);

        doc.setFont('helvetica', 'italic');
        doc.setFontSize(9);
        doc.setTextColor(15, 23, 42);
        doc.text(voucher.amountInWords, 35, y);

        // Notes (only if present)
        if (voucher.notes) {
          y += 8;
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8);
          doc.setTextColor(100, 116, 139);
          doc.text('NOTES:', 15, y);

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(71, 85, 105);
          const splitNotes = doc.splitTextToSize(voucher.notes, 150);
          doc.text(splitNotes, 35, y);
          y += splitNotes.length * 4;
        }
      }

      // QR Code & Verification Seal in PDF
      if (qrCodeUrl) {
        let y = Math.max(doc.internal.pageSize.getHeight() - 65, 200);
        doc.setDrawColor(226, 232, 240);
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(15, y, 180, 24, 1.5, 1.5, 'FD');

        try {
          doc.addImage(qrCodeUrl, 'PNG', 18, y + 2, 20, 20);
        } catch (e) {
          console.warn('Could not add QR image to PDF', e);
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(37, 99, 235);
        doc.text('VERIFIED DIGITAL TRANSACTION RECORD', 42, y + 6);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(71, 85, 105);
        doc.text(`Reference: ${voucher.voucherNo} | Type: ${voucher.voucherType} | Status: ${voucher.status.toUpperCase()}`, 42, y + 11);
        doc.text(`Verification Hash: ${voucher.verificationCode || 'SHA-256-AUTHENTICATED'}`, 42, y + 16);
        doc.text(`Scan QR code with smartphone to verify transaction legitimacy & full metadata.`, 42, y + 21);
      }

      // Signatures
      let sigY = Math.max(doc.internal.pageSize.getHeight() - 25, 255);
      const sigWidth = 50;

      // Prepared By
      doc.setDrawColor(148, 163, 184);
      doc.line(15, sigY, 15 + sigWidth, sigY);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(15, 23, 42);
      doc.text(voucher.preparedBy, 15 + sigWidth / 2, sigY + 4.5, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text('Prepared By', 15 + sigWidth / 2, sigY + 8, { align: 'center' });

      // Authorized By
      doc.line(80, sigY, 80 + sigWidth, sigY);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(15, 23, 42);
      doc.text(voucher.authorizedBy, 80 + sigWidth / 2, sigY + 4.5, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text('Authorized Signature', 80 + sigWidth / 2, sigY + 8, { align: 'center' });

      // Received By
      doc.line(145, sigY, 145 + sigWidth, sigY);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(15, 23, 42);
      doc.text(voucher.receivedBy, 145 + sigWidth / 2, sigY + 4.5, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text('Member / Receiver Signature', 145 + sigWidth / 2, sigY + 8, { align: 'center' });

      doc.save(`${voucher.voucherNo}_${voucher.entityName.replace(/\s+/g, '_')}.pdf`);
    } catch (err) {
      console.error('PDF Generation failed:', err);
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm overflow-y-auto print:p-0 print:bg-white print:static print:overflow-visible">
      <div className="relative w-full max-w-3xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 overflow-hidden my-6 flex flex-col max-h-[90vh] print:max-h-none print:shadow-none print:border-none print:my-0 print:max-w-none print:overflow-visible">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800 bg-slate-50 dark:bg-slate-850 no-print">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-xl">
              <Printer size={18} />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider">
                {voucher.title}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                {voucher.voucherNo} • {voucher.date}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopySummary}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-gray-200 dark:border-gray-700 rounded-xl transition-all shadow-sm"
              title="Copy Summary"
            >
              {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
              <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
            </button>

            <button
              onClick={handleDownloadPdf}
              disabled={isExportingPdf}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-800 rounded-xl transition-all shadow-sm"
            >
              <Download size={14} />
              <span className="hidden sm:inline">{isExportingPdf ? 'Exporting...' : 'Download PDF'}</span>
            </button>

            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 rounded-xl transition-all shadow-md shadow-blue-500/20"
            >
              <Printer size={14} />
              <span>Print Receipt</span>
            </button>

            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all ml-1"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Printable Paper Document */}
        <div className="flex-1 overflow-y-auto p-6 sm:p-8 bg-slate-100/70 dark:bg-slate-950 flex justify-center print:p-0 print:bg-white print:overflow-visible">
          <div
            id="printable-voucher-root"
            ref={printAreaRef}
            className="w-full max-w-2xl bg-white text-slate-900 p-8 rounded-xl shadow-lg border border-gray-200 relative overflow-hidden space-y-5"
          >
            {/* Header */}
            <div className="flex items-start justify-between border-b-2 border-slate-900 pb-4">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <div className="w-3.5 h-6 bg-blue-600 rounded-sm" />
                  <h1 className="text-xl font-black tracking-tight text-slate-900 uppercase">
                    {effectiveAppName}
                  </h1>
                </div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  Official Receipt
                </p>
              </div>

              <div className="text-right space-y-1">
                <div className="inline-block px-2.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded font-mono text-xs font-bold">
                  {voucher.voucherNo}
                </div>
                <div className="text-[11px] text-slate-600 font-medium">
                  Date: <span className="font-semibold text-slate-900">{voucher.date}</span>
                </div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 flex items-center justify-end gap-1">
                  <CheckCircle2 size={11} /> {voucher.status}
                </div>
              </div>
            </div>

            {/* Document Title */}
            <div className="bg-slate-50 border border-slate-200 py-2 px-4 rounded text-center">
              <h2 className="text-xs font-extrabold text-slate-900 tracking-wider uppercase">
                {voucher.title}
              </h2>
            </div>

            {/* Entity & Fund Details */}
            <div className="grid grid-cols-2 gap-4 p-3.5 rounded border border-slate-200 bg-slate-50/50 text-xs">
              <div className="space-y-1 border-r border-slate-200 pr-3">
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">
                  Member / Participant
                </span>
                <div className="font-bold text-slate-900 text-sm">
                  {voucher.entityName}
                </div>
                {voucher.entityId && (
                  <div className="text-slate-600">
                    ID: #{voucher.entityId}
                  </div>
                )}
                {voucher.entitySubtitle && (
                  <div className="text-slate-500 text-[11px]">
                    {voucher.entitySubtitle}
                  </div>
                )}
              </div>

              <div className="space-y-1 pl-1">
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">
                  Fund & Payment Method
                </span>
                <div className="font-bold text-slate-900 text-sm">
                  {voucher.fundName || 'General Fund'}
                </div>
                <div className="text-slate-600">
                  Account: {voucher.fundAccount || 'VAULT-01'}
                </div>
                <div className="text-slate-500 text-[11px]">
                  Method: {voucher.paymentMethod || 'Cash'}
                </div>
              </div>
            </div>

            {/* Enhanced Breakdown Summary Card (if Dividend/Settlement) */}
            {voucher.breakdownSummary && (
              <div className="border border-blue-200 bg-blue-50/40 rounded-lg p-3.5 space-y-3">
                <div className="flex items-center justify-between border-b border-blue-200/60 pb-2">
                  <span className="text-[10px] font-black uppercase tracking-wider text-blue-900 flex items-center gap-1.5">
                    <ShieldCheck size={13} className="text-blue-600" />
                    Shareholder Equity & Payout Reconciliation
                  </span>
                  <span className="text-[10px] font-bold text-blue-700 uppercase">
                    {voucher.breakdownSummary.sourceType}: {voucher.breakdownSummary.sourceName}
                  </span>
                </div>
                
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="bg-white p-2.5 rounded border border-blue-100 shadow-2xs">
                    <span className="text-[9px] font-bold uppercase text-slate-400 block">Member Shares</span>
                    <span className="text-sm font-black text-slate-900 font-mono">
                      {voucher.breakdownSummary.memberShares} Units
                    </span>
                    <span className="text-[9px] text-slate-500 block">
                      ({voucher.breakdownSummary.memberShareRatio} of {voucher.breakdownSummary.totalPoolShares} Units)
                    </span>
                  </div>

                  <div className="bg-white p-2.5 rounded border border-blue-100 shadow-2xs">
                    <span className="text-[9px] font-bold uppercase text-slate-400 block">Payout Rate / Unit</span>
                    <span className="text-sm font-black text-blue-600 font-mono">
                      {voucher.currency} {voucher.breakdownSummary.ratePerShare.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <span className="text-[9px] text-slate-500 block">Per Registered Unit</span>
                  </div>

                  <div className="bg-white p-2.5 rounded border border-blue-100 shadow-2xs">
                    <span className="text-[9px] font-bold uppercase text-slate-400 block">Gross Profit Share</span>
                    <span className="text-sm font-black text-emerald-600 font-mono">
                      +{voucher.currency} {voucher.breakdownSummary.grossProfit.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                    <span className="text-[9px] text-slate-500 block">Calculated Entitlement</span>
                  </div>

                  <div className="bg-white p-2.5 rounded border border-blue-100 shadow-2xs">
                    <span className="text-[9px] font-bold uppercase text-slate-400 block">Losses / Deductions</span>
                    <span className="text-sm font-black text-slate-500 font-mono">
                      {voucher.breakdownSummary.lossOrDeductions > 0 ? `-${voucher.currency} ${voucher.breakdownSummary.lossOrDeductions.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '0.00 (None)'}
                    </span>
                    <span className="text-[9px] text-slate-500 block">Overhead & Charges</span>
                  </div>
                </div>

                {voucher.breakdownSummary.projectRevenue !== undefined && voucher.breakdownSummary.projectRevenue > 0 && (
                  <div className="text-[10px] text-slate-600 bg-white/80 p-2 rounded border border-blue-100/60 flex items-center justify-between">
                    <span>Project Revenue: <strong className="text-slate-900">{voucher.currency} {voucher.breakdownSummary.projectRevenue?.toLocaleString()}</strong></span>
                    <span>Project Costs / Expenses: <strong className="text-rose-600">{voucher.currency} {voucher.breakdownSummary.projectExpenses?.toLocaleString()}</strong></span>
                    <span>Net Project Surplus: <strong className="text-emerald-600">{voucher.currency} {voucher.breakdownSummary.projectSurplus?.toLocaleString()}</strong></span>
                  </div>
                )}
              </div>
            )}

            {/* If Consolidated Distribution Schedule Roll is available */}
            {voucher.distributionSchedule && voucher.distributionSchedule.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-[11px] font-black uppercase tracking-wider text-slate-800">
                    Master Beneficiary Distribution Schedule ({voucher.distributionSchedule.length} Partners)
                  </h4>
                  <span className="text-[10px] font-mono text-slate-500">
                    Total Pool Shares: {voucher.breakdownSummary?.totalPoolShares || 0} Units
                  </span>
                </div>

                <div className="border border-slate-200 rounded overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 text-[10px] uppercase">
                        <th className="py-2 px-2 text-center w-8">#</th>
                        <th className="py-2 px-3">Partner Name</th>
                        <th className="py-2 px-2">ID</th>
                        <th className="py-2 px-2 text-center">Shares</th>
                        <th className="py-2 px-2 text-center">Ratio</th>
                        <th className="py-2 px-2 text-right">Gross Profit</th>
                        <th className="py-2 px-2 text-right">Loss/Ded.</th>
                        <th className="py-2 px-3 text-right font-black">Net Payout ({voucher.currency})</th>
                        <th className="py-2 px-3 text-center">Signature / Ack</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-800">
                      {voucher.distributionSchedule.map((m) => (
                        <tr key={m.sl} className="hover:bg-slate-50/50">
                          <td className="py-2 px-2 text-center font-mono text-[10px] text-slate-400">{m.sl}</td>
                          <td className="py-2 px-3 font-bold text-slate-900">{m.memberName}</td>
                          <td className="py-2 px-2 text-slate-500 font-mono text-[10px]">{m.memberId}</td>
                          <td className="py-2 px-2 text-center font-bold font-mono">{m.shares}</td>
                          <td className="py-2 px-2 text-center text-slate-600 font-mono text-[10px]">{m.sharePercentage.toFixed(2)}%</td>
                          <td className="py-2 px-2 text-right text-emerald-600 font-mono font-semibold">+{Number(m.grossProfit).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className="py-2 px-2 text-right text-slate-400 font-mono">{m.deductionsOrLoss > 0 ? `-${m.deductionsOrLoss}` : '0.00'}</td>
                          <td className="py-2 px-3 text-right font-black text-slate-900 font-mono">{Number(m.netPayout).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className="py-2 px-3 text-center text-slate-300 text-[10px]">____________________</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-100 font-black text-slate-900 border-t-2 border-slate-300 text-xs">
                        <td colSpan={3} className="py-2.5 px-3 uppercase text-[10px] tracking-wider">Grand Totals</td>
                        <td className="py-2.5 px-2 text-center font-mono">{voucher.distributionSchedule.reduce((s, m) => s + m.shares, 0)}</td>
                        <td className="py-2.5 px-2 text-center font-mono text-[10px]">100.00%</td>
                        <td className="py-2.5 px-2 text-right font-mono text-emerald-700">+{Number(voucher.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                        <td className="py-2.5 px-2 text-right font-mono text-slate-500">0.00</td>
                        <td className="py-2.5 px-3 text-right font-mono text-blue-700 font-black">{voucher.currency} {Number(voucher.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            ) : (
              /* Standard Line Items Table */
              <div className="border border-slate-200 rounded overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100 text-slate-600 font-bold border-b border-slate-200 text-[10px] uppercase tracking-wider">
                      <th className="py-2 px-3">Description</th>
                      <th className="py-2 px-3 text-center">Qty / Shares</th>
                      <th className="py-2 px-3 text-right">Amount ({voucher.currency})</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-800">
                    {voucher.items.map((item, idx) => (
                      <tr key={idx}>
                        <td className="py-2.5 px-3 font-medium">
                          {item.description}
                        </td>
                        <td className="py-2.5 px-3 text-center text-slate-600">
                          {item.quantity || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-slate-900 font-mono">
                          {voucher.currency} {Number(item.amount).toLocaleString('en-US')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Total Box */}
            <div className="flex items-center justify-between p-3.5 bg-blue-50/70 border-2 border-blue-200 rounded">
              <div className="text-xs font-extrabold uppercase tracking-wider text-blue-900">
                Total Net Amount:
              </div>
              <div className="text-xl font-black text-blue-600 font-mono">
                {voucher.currency} {Number(voucher.amount).toLocaleString('en-US')}
              </div>
            </div>

            {/* In Words */}
            <div className="p-2.5 bg-slate-50 rounded border border-slate-200 flex items-start gap-2 text-xs">
              <span className="font-bold text-slate-500 uppercase text-[10px] shrink-0 pt-0.5">
                In Words:
              </span>
              <span className="font-bold text-slate-900 italic">
                {voucher.amountInWords}
              </span>
            </div>

            {/* Notes (only if present) */}
            {voucher.notes ? (
              <div className="text-xs text-slate-600 border-l-2 border-slate-300 pl-3 py-0.5">
                <span className="font-bold text-slate-700">Note: </span>
                {voucher.notes}
              </div>
            ) : null}

            {/* QR Code Verification & Authenticity Seal */}
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between gap-4 page-break-avoid">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-blue-600 font-bold text-xs">
                  <ShieldCheck size={16} />
                  <span className="uppercase tracking-wider text-[10px]">Verified Digital Transaction</span>
                </div>
                <div className="text-[11px] text-slate-700 font-medium">
                  Reference: <span className="font-mono font-bold text-slate-900">{voucher.voucherNo}</span> • <span className="text-slate-500">{voucher.voucherType}</span>
                </div>
                <div className="text-[10px] text-slate-500 font-mono">
                  Hash: <span className="text-slate-700 font-semibold">{voucher.verificationCode || 'SHA-256-AUTHENTICATED'}</span>
                </div>
                <p className="text-[9px] text-slate-400">
                  Scan QR code with smartphone to verify transaction legitimacy & full metadata.
                </p>
              </div>

              {qrCodeUrl && (
                <div className="flex flex-col items-center shrink-0 bg-white p-1.5 rounded-md border border-slate-200 shadow-sm">
                  <img
                    src={qrCodeUrl}
                    alt="Transaction Verification QR Code"
                    className="w-20 h-20 sm:w-22 sm:h-22 object-contain"
                  />
                  <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mt-0.5 flex items-center gap-1">
                    <QrCode size={9} /> Scan to Verify
                  </span>
                </div>
              )}
            </div>

            {/* Signatures */}
            <div className="pt-8 grid grid-cols-3 gap-6 text-center text-xs page-break-avoid">
              <div className="space-y-1">
                <div className="border-t border-slate-400 pt-2 font-bold text-slate-900 text-[11px]">
                  {voucher.preparedBy}
                </div>
                <div className="text-[9px] text-slate-400 uppercase tracking-wider">
                  Prepared By
                </div>
              </div>

              <div className="space-y-1">
                <div className="border-t border-slate-400 pt-2 font-bold text-slate-900 text-[11px]">
                  {voucher.authorizedBy}
                </div>
                <div className="text-[9px] text-slate-400 uppercase tracking-wider">
                  Authorized Signatory
                </div>
              </div>

              <div className="space-y-1">
                <div className="border-t border-slate-400 pt-2 font-bold text-slate-900 text-[11px]">
                  {voucher.receivedBy}
                </div>
                <div className="text-[9px] text-slate-400 uppercase tracking-wider">
                  Receiver Signature
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrintableReceiptModal;
