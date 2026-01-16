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

router.get('/generate/:type/:format', protect, async (req, res) => {
  try {
    const { type, format } = req.params;
    const { fiscalMonth } = req.query;

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
    } else if (type === 'Funds Summary') {
      const funds = await Fund.find();
      data = { funds, title: 'Funds Summary Report' };
    } else if (type === 'ROI Analysis') {
      const projects = await Project.find();
      data = { projects, title: 'ROI Analysis Report' };
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
  const doc = new PDFDocument({ margin: 50 });
  
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=${type.replace(/\s+/g, '_')}_${fiscalMonth}.pdf`);
  
  doc.pipe(res);
  
  doc.fontSize(24).text(data.title || 'Report', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Period: ${fiscalMonth || 'All Time'}`, { align: 'center' });
  doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
  doc.moveDown(2);
  
  if (data.members) {
    doc.fontSize(14).text('Member Details', { underline: true });
    doc.moveDown();
    data.members.forEach((m, i) => {
      doc.fontSize(10).text(`${i + 1}. ${m.name} - Shares: ${m.shares} - Contributed: BDT ${m.totalContributed}`);
    });
  } else if (data.projects) {
    doc.fontSize(14).text('Project Details', { underline: true });
    doc.moveDown();
    data.projects.forEach((p, i) => {
      doc.fontSize(10).text(`${i + 1}. ${p.title} - Investment: BDT ${p.initialInvestment} - Return: ${p.projectedReturn}%`);
    });
  } else if (data.expenses) {
    doc.fontSize(14).text('Expense Details', { underline: true });
    doc.moveDown();
    data.expenses.forEach((e, i) => {
      doc.fontSize(10).text(`${i + 1}. ${e.description} - Amount: BDT ${e.amount} - Date: ${new Date(e.date).toLocaleDateString()}`);
    });
  } else if (data.funds) {
    doc.fontSize(14).text('Fund Details', { underline: true });
    doc.moveDown();
    data.funds.forEach((f, i) => {
      doc.fontSize(10).text(`${i + 1}. ${f.name} (${f.type}) - Balance: BDT ${f.balance}`);
    });
  }
  
  doc.end();
};

const generateExcel = async (res, data, type, fiscalMonth) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Report');
  
  worksheet.mergeCells('A1:D1');
  worksheet.getCell('A1').value = data.title || 'Report';
  worksheet.getCell('A1').font = { size: 16, bold: true };
  worksheet.getCell('A1').alignment = { horizontal: 'center' };
  
  worksheet.getCell('A2').value = `Period: ${fiscalMonth || 'All Time'}`;
  worksheet.getCell('A3').value = `Generated: ${new Date().toLocaleString()}`;
  
  if (data.members) {
    worksheet.addRow([]);
    worksheet.addRow(['Name', 'Member ID', 'Shares', 'Total Contributed', 'Status']);
    data.members.forEach(m => {
      worksheet.addRow([m.name, m.memberId, m.shares, m.totalContributed, m.status]);
    });
  } else if (data.projects) {
    worksheet.addRow([]);
    worksheet.addRow(['Title', 'Category', 'Investment', 'Projected Return', 'Status']);
    data.projects.forEach(p => {
      worksheet.addRow([p.title, p.category, p.initialInvestment, p.projectedReturn + '%', p.status]);
    });
  } else if (data.expenses) {
    worksheet.addRow([]);
    worksheet.addRow(['Description', 'Amount', 'Category', 'Date']);
    data.expenses.forEach(e => {
      worksheet.addRow([e.description, e.amount, e.category, new Date(e.date).toLocaleDateString()]);
    });
  } else if (data.funds) {
    worksheet.addRow([]);
    worksheet.addRow(['Name', 'Type', 'Balance', 'Status']);
    data.funds.forEach(f => {
      worksheet.addRow([f.name, f.type, f.balance, 'Active']);
    });
  }
  
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
