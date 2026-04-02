import React, { useState, useRef, useEffect } from 'react';
import { Download, FileSpreadsheet, FileText, Image as ImageIcon, ChevronDown, Check, Loader2 } from 'lucide-react';
// dynamic imports will be used instead
import { reportService } from '../services/api';

interface Column {
    header: string;
    key: string;
    format?: (item: any) => string;
}

interface ExportMenuProps {
    data: any[];
    columns: Column[];
    fileName: string;
    title?: string;
    lang?: string; // App language
    targetId?: string; // ID of the element to capture for JPEG
}

const ExportMenu: React.FC<ExportMenuProps> = ({ data, columns, fileName, title, lang, targetId }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [exporting, setExporting] = useState<string | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const getFormattedData = () => {
        return data.map(item => {
            const row: Record<string, any> = {};
            columns.forEach(col => {
                let val = item[col.key];
                if (col.format) {
                    val = col.format(item);
                }
                row[col.header] = val;
            });
            return row;
        });
    };

    const handleExportExcel = async () => {
        setExporting('excel');
        try {
            // Apply column formatters to the data for Excel export
            const formattedData = data.map(item => {
                const row = { ...item };
                columns.forEach(col => {
                    if (col.format) {
                        row[col.key] = col.format(item);
                    }
                });
                return row;
            });

            const blob = await reportService.exportGeneric({
                title: title || 'Strategic Finance Report',
                columns,
                data: formattedData,
                fileName,
                lang: lang || 'en'
            });

            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `${fileName}.xlsx`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Excel Export Failed:', error);
        } finally {
            setExporting(null);
            setIsOpen(false);
        }
    };

    const handleExportPDF = async () => {
        setExporting('pdf');
        try {
            const { jsPDF } = await import('jspdf');
            const autoTableBase = await import('jspdf-autotable');
            const autoTable = autoTableBase.default;

            const formattedData = getFormattedData();
            const headers = columns.map(c => c.header);
            const rows = formattedData.map(row => headers.map(h => row[h]));

            const doc = new jsPDF({
                orientation: 'landscape',
                unit: 'mm',
                format: 'a4'
            });

            // Set Brand Font Styling
            doc.setFontSize(22);
            doc.setTextColor(26, 34, 29); // #1A221D
            if (title) {
                doc.text(title.toUpperCase(), 14, 20);
            }

            doc.setFontSize(9);
            doc.setTextColor(150);
            doc.text(`INVESTWISE ENTERPRISE SYSTEMS | GENERATED: ${new Date().toLocaleString()}`, 14, 28);

            autoTable(doc, {
                head: [headers],
                body: rows,
                startY: 35,
                theme: 'grid',
                styles: {
                    fontSize: 8,
                    cellPadding: 4,
                    valign: 'middle',
                    font: 'helvetica'
                },
                headStyles: {
                    fillColor: [26, 34, 29],
                    textColor: [204, 255, 0], // Brand Neon
                    fontStyle: 'bold',
                    lineWidth: 0.1
                },
                alternateRowStyles: {
                    fillColor: [245, 248, 245]
                }
            });

            doc.save(`${fileName}.pdf`);
        } catch (error) {
            console.error('PDF Export Failed:', error);
        } finally {
            setExporting(null);
            setIsOpen(false);
        }
    };

    const handleExportJPEG = async () => {
        if (!targetId) {
            alert("Visual Capture target not specified for this view.");
            return;
        }

        setExporting('jpeg');
        try {
            const html2canvasModule = await import('html2canvas');
            const html2canvas = html2canvasModule.default;

            const element = document.getElementById(targetId);
            if (!element) throw new Error("Target element not found");

            const canvas = await html2canvas(element, {
                backgroundColor: '#f9fafb',
                scale: 2, // Higher resolution
                logging: false,
                useCORS: true
            });

            const link = document.createElement('a');
            link.download = `${fileName}.jpg`;
            link.href = canvas.toDataURL('image/jpeg', 0.9);
            link.click();
        } catch (error) {
            console.error('JPEG Export Failed:', error);
        } finally {
            setExporting(null);
            setIsOpen(false);
        }
    };

    return (
        <div className="relative" ref={menuRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="bg-white dark:bg-[#1A221D] text-dark dark:text-white border border-gray-100 dark:border-white/5 px-6 py-4 rounded-[2rem] font-black text-[11px] uppercase flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-white/10 transition-all shadow-sm group"
            >
                <Download size={16} className="group-hover:translate-y-0.5 transition-transform" />
                <span>Export Report</span>
                <ChevronDown size={14} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute top-full right-0 mt-3 w-64 bg-white dark:bg-[#1A221D] rounded-[2rem] border border-gray-100 dark:border-white/10 shadow-2xl overflow-hidden z-[100] animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="p-3 space-y-1">
                        <p className="px-4 py-2 text-[9px] font-black text-gray-400 uppercase tracking-widest">Select Format</p>

                        <button
                            onClick={handleExportExcel}
                            disabled={!!exporting}
                            className="w-full text-left px-4 py-4 rounded-2xl hover:bg-emerald-50 dark:hover:bg-emerald-500/10 flex items-center justify-between group transition-all"
                        >
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                                    <FileSpreadsheet size={18} />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-sm font-black text-dark dark:text-white uppercase tracking-tight">Excel Spreadsheet</span>
                                    <span className="text-[10px] font-bold text-gray-400">Native .xlsx format</span>
                                </div>
                            </div>
                            {exporting === 'excel' ? <Loader2 size={16} className="animate-spin text-emerald-500" /> : <Download size={14} className="opacity-0 group-hover:opacity-100 text-emerald-500" />}
                        </button>

                        <button
                            onClick={handleExportPDF}
                            disabled={!!exporting}
                            className="w-full text-left px-4 py-4 rounded-2xl hover:bg-rose-50 dark:hover:bg-rose-500/10 flex items-center justify-between group transition-all"
                        >
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-rose-50 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400">
                                    <FileText size={18} />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-sm font-black text-dark dark:text-white uppercase tracking-tight">PDF Document</span>
                                    <span className="text-[10px] font-bold text-gray-400">Professional Report</span>
                                </div>
                            </div>
                            {exporting === 'pdf' ? <Loader2 size={16} className="animate-spin text-rose-500" /> : <Download size={14} className="opacity-0 group-hover:opacity-100 text-rose-500" />}
                        </button>

                        <button
                            onClick={handleExportJPEG}
                            disabled={!!exporting || !targetId}
                            className={`w-full text-left px-4 py-4 rounded-2xl flex items-center justify-between group transition-all ${!targetId ? 'opacity-50 grayscale cursor-not-allowed' : 'hover:bg-blue-50 dark:hover:bg-blue-500/10'}`}
                        >
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400">
                                    <ImageIcon size={18} />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-sm font-black text-dark dark:text-white uppercase tracking-tight">JPEG Image</span>
                                    <span className="text-[10px] font-bold text-gray-400">Visual Snapshot</span>
                                </div>
                            </div>
                            {exporting === 'jpeg' ? <Loader2 size={16} className="animate-spin text-blue-500" /> : <Download size={14} className="opacity-0 group-hover:opacity-100 text-blue-500" />}
                        </button>
                    </div>

                    <div className="bg-gray-50/50 dark:bg-white/5 px-6 py-3 border-t border-gray-100 dark:border-white/5">

                    </div>
                </div>
            )}
        </div>
    );
};

export default ExportMenu;
