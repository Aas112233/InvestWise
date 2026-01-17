import express from 'express';
import Report from '../models/Report.js';
import { protect } from '../middleware/authMiddleware.js';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import Member from '../models/Member.js';
import Project from '../models/Project.js';
import Transaction from '../models/Transaction.js';
import Fund from '../models/Fund.js';

const router = express.Router();

router.get('/', protect, async (req, res) => {
  try {
    const reports = await Report.find().sort({ createdAt: -1 });
    res.json(reports);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/', protect, async (req, res) => {
  try {
    const report = new Report({ ...req.body, createdBy: req.user._id });
    const newReport = await report.save();
    res.status(201).json(newReport);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.get('/generate/:type', protect, async (req, res) => {
  try {
    const { type } = req.params;
    const { format, fiscalMonth, projectId, memberId } = req.query;

    let data = {};

    if (type === 'Member Contribution') {
      const members = await Member.find();
      data = { members, title: 'Member Contribution Report' };
    } else if (type === 'Project Performance') {
      const projects = await Project.find();
      data = { projects, title: 'Project Performance Report' };
    } else if (type === 'Expense Audit') {
      const expenses = await Transaction.find({ type: 'Expense' });
      data = { expenses, title: 'Expense Audit Report' };
    } else if (type === 'Project Expense Audit' && projectId) {
      const project = await Project.findById(projectId);
      const expenses = await Transaction.find({ projectId, type: 'Expense' }).sort({ date: -1 });
      data = { expenses, title: `Expense Audit: ${project?.title || 'Unknown Project'}` };
    } else if (type === 'Funds Summary') {
      const funds = await Fund.find();
      data = { funds, title: 'Funds Summary Report' };
    } else if (type === 'ROI Analysis') {
      const projects = await Project.find();
      data = { projects, title: 'ROI Analysis Report' };
    } else if (type === 'Dividend Report') {
      const members = await Member.find().sort({ totalContributed: -1 });
      data = { members, title: 'Stakeholder Dividend Distribution' };
    } else if (type === 'Stakeholder Statement') {
      const members = await Member.find();
      const transactions = await Transaction.find().sort({ date: -1 }).limit(100);
      data = { members, transactions, title: 'Consolidated Stakeholder Statement' };
    } else if (type === 'Venture Growth Matrix') {
      const projects = await Project.find().sort({ initialInvestment: -1 });
      data = { projects, title: 'Strategic Venture Growth Matrix' };
    } else if (type === 'Comprehensive Master Ledger' || type === 'Project Specific Ledger' || type === 'Member Specific Ledger') {
      let filter = {};
      let title = 'Comprehensive Master Ledger';

      if (type === 'Project Specific Ledger' && projectId) {
        const project = await Project.findById(projectId);
        filter.projectId = projectId;
        title = `Project General Ledger: ${project?.title || 'Unknown'}`;
      } else if (type === 'Member Specific Ledger' && memberId) {
        const member = await Member.findById(memberId);
        filter.memberId = memberId;
        title = `Individual Member Ledger: ${member?.name || 'Unknown'}`;
      }

      const allTransactions = await Transaction.find(filter).sort({ date: 1 });
      let currentBalance = 0;
      const transactionsWithBalance = allTransactions.map(tx => {
        const isIn = ['Deposit', 'Earning'].includes(tx.type);
        if (isIn) currentBalance += tx.amount;
        else currentBalance -= tx.amount;
        return {
          ...tx.toObject(),
          in: isIn ? tx.amount : 0,
          out: !isIn ? tx.amount : 0,
          balance: currentBalance
        };
      });
      data = { allTransactions: transactionsWithBalance.reverse(), title };
    } else if (type === 'Member Deposit History' && memberId) {
      const member = await Member.findById(memberId);
      const deposits = await Transaction.find({ memberId, type: 'Deposit' }).sort({ date: -1 });
      data = { transactions: deposits, title: `Deposit History: ${member?.name || 'Unknown'}` };
    } else if (type === 'Revenue Analytics') {
      const earnings = await Transaction.find({ type: 'Earning' }).sort({ date: -1 });
      data = { earnings, title: 'Revenue & Project Returns Analytics' };
    } else if (type === 'Interest Accruals') {
      const interest = await Transaction.find({ type: 'Earning', description: /interest/i }).sort({ date: -1 });
      data = { earnings: interest, title: 'Interest Accruals & Bank Placements' };
    }

    if (format === 'PDF') {
      generatePDF(res, data, type, fiscalMonth);
    } else if (format === 'Excel') {
      await generateExcel(res, data, type, fiscalMonth);
    } else {
      res.status(400).json({ message: 'Invalid format' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

const generatePDF = (res, data, type, fiscalMonth) => {
  const doc = new PDFDocument({ margin: 30, size: 'A4' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=${type.replace(/\s+/g, '_')}_${fiscalMonth}.pdf`);

  doc.pipe(res);

  // Brand Header Line
  doc.rect(0, 0, doc.page.width, 80).fill('#1A221D');
  doc.fillColor('#FFFFFF').fontSize(22).font('Helvetica-Bold').text(data.title || 'FINANCIAL REPORT', 0, 30, { align: 'center' });

  doc.fillColor('#9CA3AF').fontSize(8).font('Helvetica').text(`PERIOD: ${fiscalMonth || 'ALL TIME'}  |  GENERATED: ${new Date().toLocaleString().toUpperCase()}`, 0, 60, { align: 'center' });

  let y = 100;

  const drawTable = (headers, rows, colWidths, rowStyles = []) => {
    const tableX = 30;
    const cellPadding = 5;
    const rowHeight = 25;

    // Draw Headers
    doc.fillColor('#2D3748').rect(tableX, y, colWidths.reduce((a, b) => a + b, 0), rowHeight).fill();
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(9);

    let currentX = tableX;
    headers.forEach((header, i) => {
      doc.text(header.toUpperCase(), currentX, y + 8, { width: colWidths[i], align: 'center' });
      currentX += colWidths[i];
    });

    y += rowHeight;

    // Draw Rows
    rows.forEach((row, rowIndex) => {
      if (y > 750) { doc.addPage(); y = 50; }

      let cellX = tableX;
      row.forEach((cell, i) => {
        const width = colWidths[i];

        // Custom background for In/Out if applicable
        if (rowStyles[rowIndex] && rowStyles[rowIndex][i]) {
          const style = rowStyles[rowIndex][i];
          doc.fillColor(style.bg).rect(cellX, y, width, rowHeight).fill();
          doc.fillColor(style.text);
        } else {
          doc.fillColor('#000000');
        }

        // Cell Border
        doc.lineWidth(0.5).strokeColor('#E2E8F0').rect(cellX, y, width, rowHeight).stroke();

        // Text
        doc.font('Helvetica').fontSize(8).text(String(cell), cellX, y + 8, { width: width, align: 'center' });
        cellX += width;
      });
      y += rowHeight;
    });
  };

  if (data.members) {
    const headers = ['Name', 'ID', 'Shares', 'Total Contributed', 'Status'];
    const colWidths = [150, 80, 70, 130, 100];
    const rows = data.members.map(m => [m.name, m.memberId, m.shares, `BDT ${m.totalContributed}`, m.status]);
    drawTable(headers, rows, colWidths);
  } else if (data.projects) {
    const headers = ['Title', 'Category', 'Investment', 'Return', 'Status'];
    const colWidths = [180, 100, 100, 70, 80];
    const rows = data.projects.map(p => [p.title, p.category, `BDT ${p.initialInvestment}`, `${p.projectedReturn}%`, p.status]);
    drawTable(headers, rows, colWidths);
  } else if (data.allTransactions) {
    const headers = ['Date', 'Type', 'Description', 'In (Credit)', 'Out (Debit)', 'Balance'];
    const colWidths = [70, 80, 160, 75, 75, 75];
    const rows = data.allTransactions.map(tx => [
      new Date(tx.date).toLocaleDateString(),
      tx.type.toUpperCase(),
      tx.description,
      tx.in > 0 ? `+${tx.in}` : '-',
      tx.out > 0 ? `-${tx.out}` : '-',
      `BDT ${tx.balance}`
    ]);

    const rowStyles = data.allTransactions.map(tx => ({
      3: tx.in > 0 ? { bg: '#C6EFCE', text: '#006100' } : null,
      4: tx.out > 0 ? { bg: '#FFC7CE', text: '#9C0006' } : null
    }));

    drawTable(headers, rows, colWidths, rowStyles);
  } else if (data.expenses) {
    const headers = ['Description', 'Amount', 'Category', 'Date'];
    const colWidths = [200, 100, 130, 100];
    const rows = data.expenses.map(e => [e.description, `BDT ${e.amount}`, e.category, new Date(e.date).toLocaleDateString()]);
    drawTable(headers, rows, colWidths);
  } else if (data.transactions) {
    const headers = ['Date', 'Type', 'Description', 'Amount', 'Status'];
    const colWidths = [100, 100, 180, 100, 50];
    const rows = data.transactions.map(tx => [new Date(tx.date).toLocaleDateString(), tx.type.toUpperCase(), tx.description, `BDT ${tx.amount}`, tx.status]);
    drawTable(headers, rows, colWidths);
  } else if (data.earnings) {
    const headers = ['Date', 'Source', 'Amount', 'Status'];
    const colWidths = [120, 200, 130, 80];
    const rows = data.earnings.map(tx => [new Date(tx.date).toLocaleDateString(), tx.description, `BDT ${tx.amount}`, tx.status]);
    drawTable(headers, rows, colWidths);
  }

  doc.end();
};

const generateExcel = async (res, data, type, fiscalMonth) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Report');

  // Title Styling
  worksheet.mergeCells('A1:G1');
  const titleCell = worksheet.getCell('A1');
  titleCell.value = data.title || 'Report';
  titleCell.font = { size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A221D' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

  worksheet.getCell('A2').value = `Period: ${fiscalMonth || 'All Time'}`;
  worksheet.getCell('A3').value = `Generated: ${new Date().toLocaleString()}`;
  worksheet.getRow(2).font = { bold: true };
  worksheet.getRow(3).font = { italic: true };

  // Helper function for borders and centering
  const applyCellStyle = (cell, isHeader = false) => {
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    };
    if (isHeader) {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D3748' } };
    }
  };

  if (data.members) {
    worksheet.addRow([]);
    const headerRow = worksheet.addRow(['Name', 'Member ID', 'Shares', 'Total Contributed', 'Status']);
    headerRow.eachCell(cell => applyCellStyle(cell, true));
    data.members.forEach(m => {
      const row = worksheet.addRow([m.name, m.memberId, m.shares, m.totalContributed, m.status]);
      row.eachCell(cell => applyCellStyle(cell));
    });
  } else if (data.projects) {
    worksheet.addRow([]);
    const headerRow = worksheet.addRow(['Title', 'Category', 'Investment', 'Projected Return', 'Status']);
    headerRow.eachCell(cell => applyCellStyle(cell, true));
    data.projects.forEach(p => {
      const row = worksheet.addRow([p.title, p.category, p.initialInvestment, p.projectedReturn + '%', p.status]);
      row.eachCell(cell => applyCellStyle(cell));
    });
  } else if (data.expenses) {
    worksheet.addRow([]);
    const headerRow = worksheet.addRow(['Description', 'Amount', 'Category', 'Date']);
    headerRow.eachCell(cell => applyCellStyle(cell, true));
    data.expenses.forEach(e => {
      const row = worksheet.addRow([e.description, e.amount, e.category, new Date(e.date).toLocaleDateString()]);
      row.eachCell(cell => applyCellStyle(cell));
    });
  } else if (data.funds) {
    worksheet.addRow([]);
    const headerRow = worksheet.addRow(['Name', 'Type', 'Balance', 'Status']);
    headerRow.eachCell(cell => applyCellStyle(cell, true));
    data.funds.forEach(f => {
      const row = worksheet.addRow([f.name, f.type, f.balance, 'Active']);
      row.eachCell(cell => applyCellStyle(cell));
    });
  } else if (data.allTransactions) {
    worksheet.addRow([]);
    const headerRow = worksheet.addRow(['Date', 'Type', 'Description', 'In (Credit)', 'Out (Debit)', 'Running Balance', 'Status']);
    headerRow.eachCell(cell => applyCellStyle(cell, true));

    data.allTransactions.forEach(tx => {
      const row = worksheet.addRow([
        new Date(tx.date).toLocaleDateString(),
        tx.type,
        tx.description,
        tx.in || '-',
        tx.out || '-',
        tx.balance,
        tx.status
      ]);

      row.eachCell((cell, colNumber) => {
        applyCellStyle(cell);

        // Color coding for In (Col 4) and Out (Col 5)
        if (colNumber === 4 && tx.in > 0) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } }; // Light Green
          cell.font = { color: { argb: 'FF006100' }, bold: true }; // Dark Green Text
        }
        if (colNumber === 5 && tx.out > 0) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } }; // Light Red
          cell.font = { color: { argb: 'FF9C0006' }, bold: true }; // Dark Red Text
        }
      });
    });
  } else if (data.transactions) {
    worksheet.addRow([]);
    const headerRow = worksheet.addRow(['Date', 'Type', 'Description', 'Amount', 'Status']);
    headerRow.eachCell(cell => applyCellStyle(cell, true));
    data.transactions.forEach(tx => {
      const row = worksheet.addRow([new Date(tx.date).toLocaleDateString(), tx.type, tx.description, tx.amount, tx.status]);
      row.eachCell(cell => applyCellStyle(cell));
    });
  } else if (data.earnings) {
    worksheet.addRow([]);
    const headerRow = worksheet.addRow(['Date', 'Source', 'Amount', 'Status']);
    headerRow.eachCell(cell => applyCellStyle(cell, true));
    data.earnings.forEach(tx => {
      const row = worksheet.addRow([new Date(tx.date).toLocaleDateString(), tx.description, tx.amount, tx.status]);
      row.eachCell(cell => applyCellStyle(cell));
    });
  }

  // Auto-fit columns
  worksheet.columns.forEach(column => {
    column.width = 20;
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=${type.replace(/\s+/g, '_')}_${fiscalMonth}.xlsx`);

  await workbook.xlsx.write(res);
  res.end();
};

router.delete('/:id', protect, async (req, res) => {
  try {
    await Report.findByIdAndDelete(req.params.id);
    res.json({ message: 'Report deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
