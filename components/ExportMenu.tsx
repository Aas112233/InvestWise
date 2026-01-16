
import React, { useState, useRef, useEffect } from 'react';
import { Download, FileSpreadsheet, FileText, ChevronDown } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface Column {
    header: string;
    key: string;
    format?: (item: any) => string;
}

interface ExportMenuProps {
    data: any[];
    columns: Column[];
    fileName: string;
    title?: string; // For the PDF title
}

const ExportMenu: React.FC<ExportMenuProps> = ({ data, columns, fileName, title }) => {
    const [isOpen, setIsOpen] = useState(false);
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
                // Handle nested keys like 'member.name' if necessary, though simpler to rely on passed 'key' matching data or 'format'
                let val = item[col.key];
                if (col.format) {
                    val = col.format(item);
                }
                row[col.header] = val;
            });
            return row;
        });
    };

    const handleExportCSV = () => {
        const formattedData = getFormattedData();
        if (formattedData.length === 0) return;

        const headers = columns.map(c => c.header);
        const csvContent = [
            headers.map(h => `"${h.replace(/"/g, '""')}"`).join(','), // Quote headers
            ...formattedData.map(row =>
                headers.map(header => {
                    const val = row[header] === null || row[header] === undefined ? '' : String(row[header]);
                    return `"${val.replace(/"/g, '""')}"`;
                }).join(',')
            )
        ].join('\n');

        // Add Byte Order Mark (BOM) for Excel UTF-8 compatibility
        const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', `${fileName}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
        setIsOpen(false);
    };

    const handleExportPDF = () => {
        const formattedData = getFormattedData();
        const headers = columns.map(c => c.header);
        const rows = formattedData.map(row => headers.map(h => row[h]));

        const doc = new jsPDF();

        // Add title
        if (title) {
            doc.setFontSize(16);
            doc.setTextColor(40); // Darker text
            doc.text(title, 14, 20);

            doc.setFontSize(10);
            doc.setTextColor(100);
            doc.text(`Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}`, 14, 28);
        }

        autoTable(doc, {
            head: [headers],
            body: rows,
            startY: title ? 35 : 15, // Adjusted margin
            theme: 'grid',
            styles: {
                fontSize: 8,
                cellPadding: 3,
                valign: 'middle'
            },
            headStyles: {
                fillColor: [41, 128, 185],
                textColor: 255,
                fontStyle: 'bold'
            },
            columnStyles: {
                // Optional: add wrapping if needed, but autoTable handles it mostly
            }
        });

        doc.save(`${fileName}.pdf`);
        setIsOpen(false);
    };

    return (
        <div className="relative" ref={menuRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="bg-white dark:bg-[#1A221D] text-dark dark:text-white border border-gray-100 dark:border-white/5 px-6 py-4 rounded-[2rem] font-black text-[11px] uppercase flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-white/10 transition-all shadow-sm"
            >
                <Download size={16} />
                <span>Export</span>
                <ChevronDown size={14} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute top-full right-0 mt-2 w-48 bg-white dark:bg-[#1A221D] rounded-2xl border border-gray-100 dark:border-white/10 shadow-xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-200">
                    <div className="p-2">
                        <button
                            onClick={handleExportCSV}
                            className="w-full text-left px-4 py-3 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 flex items-center gap-3 text-sm font-bold text-gray-600 dark:text-gray-300 transition-colors"
                        >
                            <FileSpreadsheet size={16} className="text-emerald-500" />
                            <span>As Excel (CSV)</span>
                        </button>
                        <button
                            onClick={handleExportPDF}
                            className="w-full text-left px-4 py-3 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 flex items-center gap-3 text-sm font-bold text-gray-600 dark:text-gray-300 transition-colors"
                        >
                            <FileText size={16} className="text-rose-500" />
                            <span>As PDF</span>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ExportMenu;
