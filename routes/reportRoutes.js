import express from 'express';
import Report from '../models/Report.js';
import { protect } from '../middleware/authMiddleware.js';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import Member from '../models/Member.js';
import Project from '../models/Project.js';
import Transaction from '../models/Transaction.js';
import Fund from '../models/Fund.js';
import ExcelDesigner from '../utils/excelDesigner.js';

const router = express.Router();
const formatDate = (date) => {
  if (!date) return '-';
  const d = new Date(date);
  if (isNaN(d.getTime())) return date;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
};

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

router.post('/export-generic', protect, async (req, res) => {
  try {
    const { title, columns, data, fileName, lang } = req.body;

    const workbook = new ExcelJS.Workbook();
    const designer = new ExcelDesigner(workbook);

    designer.init(title, 'EX-DATA', lang || 'en');

    const headers = columns.map(c => c.header);
    const rows = data.map(item => columns.map(col => {
      const val = item[col.header] || item[col.key] || '-';
      // Auto-format dates if they looks like ISO strings in generic export
      if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val)) {
        return formatDate(val);
      }
      return val;
    }));

    designer.addTable(headers, rows);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName || 'export'}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

const getDateFilter = (period, dateStr) => {
  if (!period || !dateStr || period === 'All Time') return {};

  let start = new Date();
  let end = new Date();

  if (period === 'Monthly') {
    const [year, month] = dateStr.split('-');
    start = new Date(year, month - 1, 1);
    end = new Date(year, month, 0, 23, 59, 59);
  } else if (period === 'Quarterly') {
    const [year, quarter] = dateStr.split('-');
    const qNum = parseInt(quarter.substring(1));
    start = new Date(year, (qNum - 1) * 3, 1);
    end = new Date(year, qNum * 3, 0, 23, 59, 59);
  } else if (period === 'Yearly') {
    start = new Date(dateStr, 0, 1);
    end = new Date(dateStr, 11, 31, 23, 59, 59);
  } else if (period === 'Custom') {
    const [startStr, endStr] = dateStr.split('_to_');
    start = new Date(startStr);
    end = new Date(endStr);
    end.setHours(23, 59, 59);
  }

  return { date: { $gte: start, $lte: end } };
};

router.get('/generate/:type', protect, async (req, res) => {
  try {
    const { type } = req.params;
    const { format, period, date, projectId, memberId, fundId } = req.query;
    const dateQuery = getDateFilter(period, date);
    const dateLabel = date || 'ALL TIME';

    let data = {};

    if (type === 'Member Contribution') {
      const members = await Member.find().sort({ totalContributed: -1 });
      data = { members, title: 'Member Contribution Report' };
    } else if (type === 'Project Performance') {
      const projects = await Project.find();
      data = { projects, title: 'Project Performance Report' };
    } else if (type === 'Expense Audit') {
      const expenses = await Transaction.find({ type: 'Expense', ...dateQuery }).sort({ date: -1 });
      data = { expenses, title: 'Expense Audit Report' };
    } else if (type === 'Project Expense Audit' && projectId) {
      const project = await Project.findById(projectId);
      const expenses = await Transaction.find({ projectId, type: 'Expense', ...dateQuery }).sort({ date: -1 });
      data = { expenses, title: `Expense Audit: ${project?.title || 'Unknown Project'}` };
    } else if (type === 'Funds Summary') {
      const funds = await Fund.find();
      data = { funds, title: 'Funds Summary Report' };
    } else if (type === 'ROI Analysis') {
      const projects = await Project.find();
      data = { projects, title: 'Venture ROI Analysis Report' };
    } else if (type === 'Dividend Report') {
      const members = await Member.find().sort({ totalContributed: -1 });
      data = { members, title: 'Stakeholder Dividend Distribution' };
    } else if (type === 'Stakeholder Statement') {
      const members = await Member.find();
      const transactions = await Transaction.find(dateQuery).sort({ date: -1 }).limit(100);
      data = { members, transactions, title: 'Consolidated Stakeholder Statement' };
    } else if (type === 'Venture Growth Matrix') {
      const projects = await Project.find().sort({ initialInvestment: -1 });
      data = { projects, title: 'Strategic Venture Growth Matrix' };
    } else if (type === 'Comprehensive Master Ledger' || type === 'Project Specific Ledger' || type === 'Member Specific Ledger' || type === 'Fund Specific Ledger') {
      let filter = { ...dateQuery };
      let title = 'Comprehensive Master Ledger';

      if (type === 'Project Specific Ledger' && projectId) {
        const project = await Project.findById(projectId);
        filter.projectId = projectId;
        title = `Project General Ledger: ${project?.title || 'Unknown'}`;
      } else if (type === 'Member Specific Ledger' && memberId) {
        const member = await Member.findById(memberId);
        filter.memberId = memberId;
        title = `Individual Member Ledger: ${member?.name || 'Unknown'}`;
      } else if (type === 'Fund Specific Ledger' && fundId) {
        const fund = await Fund.findById(fundId);
        filter.fundId = fundId;
        title = `Internal Fund Ledger: ${fund?.name || 'Unknown'}`;
      }

      const allTransactions = await Transaction.find(filter)
        .populate('fundId', 'name')
        .populate('projectId', 'title')
        .sort({ date: 1 });

      let currentBalance = 0;
      const transactionsWithBalance = allTransactions.map(tx => {
        // Financial Protocol: 
        // Inflows (Credit): Deposit, Earning, Investment
        // Outflows (Debit): Withdrawal, Expense, Dividend
        // Neutral (Equity): Equity-Transfer (Doesn't affect cash balance)
        const isIn = ['Deposit', 'Earning', 'Investment'].includes(tx.type);
        const isOut = ['Withdrawal', 'Expense', 'Dividend'].includes(tx.type);

        if (isIn) {
          currentBalance += tx.amount;
        } else if (isOut) {
          currentBalance -= tx.amount;
        }

        return {
          ...tx.toObject(),
          in: isIn ? tx.amount : 0,
          out: isOut ? tx.amount : 0,
          balance: currentBalance
        };
      });
      data = { allTransactions: transactionsWithBalance.reverse(), title };
    } else if (type === 'Member Deposit History' && memberId) {
      const member = await Member.findById(memberId);
      const deposits = await Transaction.find({ memberId, type: 'Deposit', ...dateQuery }).sort({ date: -1 });
      data = { transactions: deposits, title: `Deposit History: ${member?.name || 'Unknown'}` };
    } else if (type === 'Revenue Analytics') {
      const earnings = await Transaction.find({ type: 'Earning', ...dateQuery })
        .populate('projectId', 'title')
        .populate('fundId', 'name')
        .sort({ date: -1 });
      data = { earnings, title: 'Direct Revenue & Profit Analytics' };
    } else if (type === 'Earnings Ledger') {
      const earnings = await Transaction.find({ type: 'Earning', ...dateQuery })
        .populate('projectId', 'title')
        .populate('fundId', 'name')
        .sort({ date: 1 });

      let currentBalance = 0;
      const earningsWithBalance = earnings.map(tx => {
        currentBalance += tx.amount;
        return {
          ...tx.toObject(),
          in: tx.amount,
          out: 0,
          balance: currentBalance
        };
      });
      data = { allTransactions: earningsWithBalance.reverse(), title: 'Venture Earnings & General Profit Ledger' };
    } else if (type === 'Interest Accruals') {
      const interest = await Transaction.find({ type: { $in: ['Earning', 'Investment'] }, description: /interest/i, ...dateQuery })
        .populate('projectId', 'title')
        .populate('fundId', 'name')
        .sort({ date: -1 });
      data = { earnings: interest, title: 'Interest Accruals & Bank Placements' };
    }

    if (format === 'PDF') {
      generatePDF(res, data, type, dateLabel);
    } else if (format === 'Excel') {
      await generateExcel(res, data, type, dateLabel);
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
  res.setHeader('Content-Disposition', `attachment; filename=${type.replace(/\s+/g, '_')}_${fiscalMonth.replace(/:/g, '-')}.pdf`);

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
    const headers = ['Title', 'Invested', 'Earned', 'Expenses', 'ROI (%)', 'Status'];
    const colWidths = [150, 90, 90, 90, 60, 60];
    const rows = data.projects.map(p => [
      p.title,
      `BDT ${p.initialInvestment}`,
      `BDT ${p.totalEarnings || 0}`,
      `BDT ${p.totalExpenses || 0}`,
      `${p.expectedRoi || 0}%`,
      p.status
    ]);
    drawTable(headers, rows, colWidths);
  } else if (data.allTransactions) {
    const headers = ['Date', 'Type', 'Fund', 'Description', 'Fund In', 'Fund Out', 'Balance'];
    const colWidths = [60, 60, 80, 115, 70, 70, 80];
    const rows = data.allTransactions.map(tx => [
      formatDate(tx.date),
      tx.type.toUpperCase(),
      tx.fundId?.name || '-',
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
    const rows = data.expenses.map(e => [e.description, `BDT ${e.amount}`, e.category, formatDate(e.date)]);
    drawTable(headers, rows, colWidths);
  } else if (data.transactions) {
    const headers = ['Date', 'Type', 'Description', 'Amount', 'Status'];
    const colWidths = [100, 100, 180, 100, 50];
    const rows = data.transactions.map(tx => [formatDate(tx.date), tx.type.toUpperCase(), tx.description, `BDT ${tx.amount}`, tx.status]);
    drawTable(headers, rows, colWidths);
  } else if (data.earnings) {
    const headers = ['Date', 'Project', 'Fund', 'Source/Memo', 'Amount', 'Status'];
    const colWidths = [60, 100, 80, 130, 100, 60];
    const rows = data.earnings.map(tx => [
      formatDate(tx.date),
      tx.projectId?.title || '-',
      tx.fundId?.name || '-',
      tx.description,
      `BDT ${tx.amount}`,
      tx.status
    ]);
    drawTable(headers, rows, colWidths);
  }

  doc.end();
};

const generateExcel = async (res, data, type, fiscalMonth, lang = 'en') => {
  const workbook = new ExcelJS.Workbook();
  const designer = new ExcelDesigner(workbook);

  designer.init(data.title, fiscalMonth || 'All Time', lang);

  let headers = [];
  let rows = [];
  let options = {};

  const langMap = {
    en: {
      name: 'Name', memberId: 'Member ID', shares: 'Shares', totalContributed: 'Total Contributed (BDT)', status: 'Status',
      title: 'Title', category: 'Category', investment: 'Investment (BDT)', projectedReturn: 'Projected Return',
      description: 'Description', amount: 'Amount (BDT)', date: 'Date',
      fundName: 'Fund Name', type: 'Type', balance: 'Balance (BDT)',
      credit: 'Fund In (Credit)', debit: 'Fund Out (Debit)', runningBalance: 'Running Balance (BDT)', source: 'Source',
      fund: 'Fund Account'
    },
    bn: {
      name: 'নাম', memberId: 'মেম্বার আইডি', shares: 'শেয়ার সংখ্যা', totalContributed: 'মোট অবদান (BDT)', status: 'অবস্থা',
      title: 'শিরোনাম', category: 'বিভাগ', investment: 'বিনিয়োগ (BDT)', projectedReturn: 'প্রত্যাশিত আয়',
      description: 'বিবরণ', amount: 'পরিমাণ (BDT)', date: 'তারিখ',
      fundName: 'ফান্ডের নাম', type: 'ধরণ', balance: 'ব্যালেন্স (BDT)',
      credit: 'আমানত (ইন)', debit: 'ব্যয় (আউট)', runningBalance: 'স্থিতি (BDT)', source: 'উৎস',
      fund: 'ফান্ড অ্যাকাউন্ট'
    }
  };

  const t = langMap[lang] || langMap.en;

  if (data.members) {
    headers = [t.name, t.memberId, t.shares, t.totalContributed, t.status];
    rows = data.members.map(m => [m.name, m.memberId, m.shares, m.totalContributed, m.status]);
  } else if (data.projects) {
    headers = [t.title, t.investment, 'Earnings (BDT)', 'Expenses (BDT)', 'ROI (%)', t.status];
    rows = data.projects.map(p => [p.title, p.initialInvestment, p.totalEarnings || 0, p.totalExpenses || 0, `${p.expectedRoi || 0}%`, p.status]);
  } else if (data.expenses) {
    headers = [t.description, t.amount, t.category, t.date];
    rows = data.expenses.map(e => [e.description, e.amount, e.category, formatDate(e.date)]);
  } else if (data.funds) {
    headers = [t.fundName, t.type, t.balance, t.status];
    rows = data.funds.map(f => [f.name, f.type, f.balance, 'Active']);
  } else if (data.allTransactions) {
    headers = [t.date, t.type, t.fund, t.description, t.credit, t.debit, t.runningBalance, t.status];
    rows = data.allTransactions.map(tx => [
      formatDate(tx.date),
      tx.type.toUpperCase(),
      tx.fundId?.name || '-',
      tx.description,
      tx.in > 0 ? `+${tx.in}` : '-',
      tx.out > 0 ? `-${tx.out}` : '-',
      tx.balance,
      tx.status
    ]);
    options.isLedger = true;
  } else if (data.transactions) {
    headers = [t.date, t.type, t.description, t.amount, t.status];
    rows = data.transactions.map(tx => [formatDate(tx.date), tx.type.toUpperCase(), tx.description, tx.amount, tx.status]);
  } else if (data.earnings) {
    headers = [t.date, t.title, t.fund, t.source, t.amount, t.status];
    rows = data.earnings.map(tx => [formatDate(tx.date), tx.projectId?.title || '-', tx.fundId?.name || '-', tx.description, tx.amount, tx.status]);
  }

  designer.addTable(headers, rows, options);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=${type.replace(/\s+/g, '_')}_${fiscalMonth.replace(/:/g, '-')}.xlsx`);

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
