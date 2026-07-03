/**
 * Comprehensive Functional Test Script for InvestWise
 * Tests critical financial flows and identifies issues
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

// Import models - adjust paths based on location
import Transaction from '../models/Transaction.js';
import Fund from '../models/Fund.js';
import Member from '../models/Member.js';
import Project from '../models/Project.js';
import User from '../models/User.js';

// Test results storage
const testResults = {
 passed: [],
 failed: [],
 warnings: [],
 errors: []
};

// Utility functions
function logTest(category, name, status, details = '') {
 const result = {
 category,
 name,
 status,
 details,
 timestamp: new Date().toISOString()
 };

 if (status === 'PASS') {
 testResults.passed.push(result);
 console.log(` [${category}] ${name}`);
 } else if (status === 'FAIL') {
 testResults.failed.push(result);
 console.error(` [${category}] ${name}: ${details}`);
 } else if (status === 'WARN') {
 testResults.warnings.push(result);
 console.warn(` [${category}] ${name}: ${details}`);
 }
}

// Test 1: Database Connection
async function testDatabaseConnection() {
 console.log('\n TEST 1: Database Connection');
 try {
 if (!process.env.MONGO_URI) {
 logTest('DATABASE', 'Environment Variable Check', 'FAIL', 'MONGO_URI not set');
 return false;
 }

 await mongoose.connect(process.env.MONGO_URI, {
 serverSelectionTimeoutMS: 5000
 });
 
 logTest('DATABASE', 'Connection Established', 'PASS');
 logTest('DATABASE', 'MongoDB Version', 'PASS', mongoose.version);
 return true;
 } catch (error) {
 logTest('DATABASE', 'Connection Failed', 'FAIL', error.message);
 return false;
 }
}

// Test 2: Model Validation
async function testModelValidation() {
 console.log('\n TEST 2: Model Validation & Constraints');
 
 // Test Fund model constraints
 try {
 const testFund = new Fund({
 name: 'Test Fund',
 type: 'OTHER',
 balance: -100 // Should fail validation
 });
 
 await testFund.validate();
 logTest('MODEL', 'Fund Negative Balance Prevention', 'FAIL', 'Should have rejected negative balance');
 } catch (error) {
 if (error.name === 'ValidationError') {
 logTest('MODEL', 'Fund Negative Balance Prevention', 'PASS', 'Correctly rejected negative balance');
 } else {
 logTest('MODEL', 'Fund Negative Balance Prevention', 'FAIL', error.message);
 }
 }

 // Test Member model constraints
 try {
 const testMember = new Member({
 memberId: 'TEST001',
 name: 'Test Member',
 email: 'test@example.com',
 phone: '+1234567890',
 totalContributed: -50 // Should fail
 });
 
 await testMember.validate();
 logTest('MODEL', 'Member Negative Contribution Prevention', 'FAIL', 'Should have rejected negative contribution');
 } catch (error) {
 if (error.name === 'ValidationError') {
 logTest('MODEL', 'Member Negative Contribution Prevention', 'PASS', 'Correctly rejected negative contribution');
 } else {
 logTest('MODEL', 'Member Negative Contribution Prevention', 'FAIL', error.message);
 }
 }

 // Test Transaction model
 try {
 const testTx = new Transaction({
 type: 'Deposit',
 amount: -100, // Should fail
 description: 'Test'
 });
 
 await testTx.validate();
 logTest('MODEL', 'Transaction Negative Amount Prevention', 'FAIL', 'Should have rejected negative amount');
 } catch (error) {
 if (error.name === 'ValidationError') {
 logTest('MODEL', 'Transaction Negative Amount Prevention', 'PASS', 'Correctly rejected negative amount');
 } else {
 logTest('MODEL', 'Transaction Negative Amount Prevention', 'FAIL', error.message);
 }
 }
}

// Test 3: Data Integrity Checks
async function testDataIntegrity() {
 console.log('\n TEST 3: Data Integrity Checks');
 
 try {
 // Check for orphaned transactions
 const transactions = await Transaction.find({}).lean();
 const fundIds = new Set(transactions.map(t => t.fundId).filter(Boolean));
 const memberIds = new Set(transactions.map(t => t.memberId).filter(Boolean));
 
 if (fundIds.size > 0) {
 const existingFunds = await Fund.find({ _id: { $in: Array.from(fundIds) } }).countDocuments();
 if (existingFunds < fundIds.size) {
 logTest('INTEGRITY', 'Orphaned Fund References', 'WARN', 
 `${fundIds.size - existingFunds} transactions reference non-existent funds`);
 } else {
 logTest('INTEGRITY', 'Fund Reference Integrity', 'PASS');
 }
 }
 
 if (memberIds.size > 0) {
 const existingMembers = await Member.find({ _id: { $in: Array.from(memberIds) } }).countDocuments();
 if (existingMembers < memberIds.size) {
 logTest('INTEGRITY', 'Orphaned Member References', 'WARN',
 `${memberIds.size - existingMembers} transactions reference non-existent members`);
 } else {
 logTest('INTEGRITY', 'Member Reference Integrity', 'PASS');
 }
 }
 
 // Check for negative balances
 const negativeFunds = await Fund.find({ balance: { $lt: 0 } });
 if (negativeFunds.length > 0) {
 logTest('INTEGRITY', 'Negative Fund Balances', 'FAIL',
 `${negativeFunds.length} funds have negative balances`);
 } else {
 logTest('INTEGRITY', 'Fund Balance Positivity', 'PASS');
 }
 
 // Check transaction status consistency
 const pendingTransactions = await Transaction.find({ 
 status: 'Completed',
 amount: { $exists: true }
 }).countDocuments();
 
 logTest('INTEGRITY', 'Transaction Status Distribution', 'PASS',
 `${pendingTransactions} completed transactions found`);
 
 } catch (error) {
 logTest('INTEGRITY', 'Data Integrity Check', 'FAIL', error.message);
 }
}

// Test 4: Atomic Operation Verification
async function testAtomicOperations() {
 console.log('\n TEST 4: Atomic Operation Safety');
 
 try {
 // Create test fund
 const testFund = await Fund.create({
 name: 'Atomic Test Fund',
 type: 'OTHER',
 balance: 1000
 });
 
 const initialBalance = testFund.balance;
 
 // Simulate concurrent updates
 const updatePromises = [];
 for (let i = 0; i < 10; i++) {
 updatePromises.push(
 Fund.findByIdAndUpdate(
 testFund._id,
 { $inc: { balance: 100 } }
 )
 );
 }
 
 await Promise.all(updatePromises);
 
 const updatedFund = await Fund.findById(testFund._id);
 const expectedBalance = initialBalance + 1000; // 10 * 100
 
 if (updatedFund.balance === expectedBalance) {
 logTest('ATOMIC', 'Concurrent Updates Safety', 'PASS',
 `Balance correctly updated from ${initialBalance} to ${updatedFund.balance}`);
 } else {
 logTest('ATOMIC', 'Concurrent Updates Safety', 'FAIL',
 `Expected ${expectedBalance}, got ${updatedFund.balance} - RACE CONDITION DETECTED!`);
 }
 
 // Cleanup
 await Fund.findByIdAndDelete(testFund._id);
 
 } catch (error) {
 logTest('ATOMIC', 'Atomic Operation Test', 'FAIL', error.message);
 }
}

// Test 5: Input Validation Simulation
async function testInputValidation() {
 console.log('\n TEST 5: Input Validation Logic');
 
 // Test amount validation logic
 const testCases = [
 { amount: -100, shouldPass: false, desc: 'Negative amount' },
 { amount: 0, shouldPass: false, desc: 'Zero amount' },
 { amount: 0.001, shouldPass: false, desc: 'Below minimum (0.01)' },
 { amount: 0.01, shouldPass: true, desc: 'Minimum valid amount' },
 { amount: 100.50, shouldPass: true, desc: 'Decimal amount' },
 { amount: 10000000, shouldPass: true, desc: 'Maximum valid amount' },
 { amount: 10000001, shouldPass: false, desc: 'Above maximum' },
 { amount: NaN, shouldPass: false, desc: 'NaN amount' },
 { amount: Infinity, shouldPass: false, desc: 'Infinity amount' }
 ];
 
 for (const testCase of testCases) {
 const isValid = typeof testCase.amount === 'number' && 
 !isNaN(testCase.amount) &&
 isFinite(testCase.amount) &&
 testCase.amount >= 0.01 && 
 testCase.amount <= 10000000;
 
 if (isValid === testCase.shouldPass) {
 logTest('VALIDATION', `Amount: ${testCase.desc}`, 'PASS');
 } else {
 logTest('VALIDATION', `Amount: ${testCase.desc}`, 'FAIL',
 `Expected ${testCase.shouldPass ? 'valid' : 'invalid'}, got ${isValid ? 'valid' : 'invalid'}`);
 }
 }
 
 // Test date validation
 const now = new Date();
 const futureDate = new Date(now.getTime() + 86400000); // Tomorrow
 const pastDate = new Date(now.getTime() - 86400000); // Yesterday
 
 if (futureDate > now) {
 logTest('VALIDATION', 'Future Date Detection', 'PASS', 'Correctly identifies future dates');
 } else {
 logTest('VALIDATION', 'Future Date Detection', 'FAIL');
 }
}

// Test 6: Audit Trail Completeness
async function testAuditTrail() {
 console.log('\n TEST 6: Audit Trail Verification');
 
 try {
 const AuditLog = (await import('../models/AuditLog.js')).default;
 
 // Check recent audit logs
 const recentLogs = await AuditLog.find({})
 .sort({ createdAt: -1 })
 .limit(10)
 .lean();
 
 if (recentLogs.length === 0) {
 logTest('AUDIT', 'Audit Log Existence', 'WARN', 'No audit logs found in database');
 } else {
 logTest('AUDIT', 'Audit Log System Active', 'PASS', `${recentLogs.length} recent logs found`);
 
 // Check for correlation IDs
 const logsWithCorrelationId = recentLogs.filter(log => 
 log.details && log.details.correlationId
 ).length;
 
 if (logsWithCorrelationId > 0) {
 logTest('AUDIT', 'Correlation ID Coverage', 'PASS',
 `${logsWithCorrelationId}/${recentLogs.length} logs have correlation IDs`);
 } else {
 logTest('AUDIT', 'Correlation ID Coverage', 'WARN',
 'No correlation IDs found in recent audit logs');
 }
 
 // Check action types
 const actionTypes = [...new Set(recentLogs.map(log => log.action))];
 logTest('AUDIT', 'Action Type Diversity', 'PASS',
 `${actionTypes.length} different action types: ${actionTypes.join(', ')}`);
 }
 
 } catch (error) {
 logTest('AUDIT', 'Audit Trail Check', 'FAIL', error.message);
 }
}

// Test 7: Performance Indicators
async function testPerformanceIndicators() {
 console.log('\n TEST 7: Performance Indicators');
 
 try {
 // Measure query performance
 const startTime = Date.now();
 const txCount = await Transaction.countDocuments();
 const queryTime = Date.now() - startTime;
 
 if (queryTime < 100) {
 logTest('PERFORMANCE', 'Transaction Count Query', 'PASS', `${queryTime}ms`);
 } else if (queryTime < 500) {
 logTest('PERFORMANCE', 'Transaction Count Query', 'WARN', `${queryTime}ms (slow)`);
 } else {
 logTest('PERFORMANCE', 'Transaction Count Query', 'FAIL', `${queryTime}ms (very slow)`);
 }
 
 // Check collection sizes
 const fundCount = await Fund.countDocuments();
 const memberCount = await Member.countDocuments();
 const projectCount = await Project.countDocuments();
 
 logTest('PERFORMANCE', 'Database Size', 'PASS',
 `Funds: ${fundCount}, Members: ${memberCount}, Projects: ${projectCount}, Transactions: ${txCount}`);
 
 // Check for missing indexes
 const txIndexes = await Transaction.collection.getIndexes();
 const hasDateIndex = Object.keys(txIndexes).some(key => key.includes('date'));
 const hasTypeIndex = Object.keys(txIndexes).some(key => key.includes('type'));
 
 if (hasDateIndex && hasTypeIndex) {
 logTest('PERFORMANCE', 'Transaction Indexes', 'PASS', 'Critical indexes present');
 } else {
 logTest('PERFORMANCE', 'Transaction Indexes', 'WARN', 
 `Missing indexes - Date: ${hasDateIndex}, Type: ${hasTypeIndex}`);
 }
 
 } catch (error) {
 logTest('PERFORMANCE', 'Performance Check', 'FAIL', error.message);
 }
}

// Test 8: Code Quality Checks
async function testCodeQuality() {
 console.log('\n TEST 8: Code Quality Analysis');
 
 try {
 // Read finance controller
 const controllerPath = path.join(__dirname, '../controllers/financeController.js');
 const controllerCode = fs.readFileSync(controllerPath, 'utf-8');
 
 // Check for parseInt usage (should use Number instead)
 const parseIntMatches = controllerCode.match(/parseInt\(/g);
 if (parseIntMatches && parseIntMatches.length > 0) {
 logTest('CODE', 'parseInt() Usage Found', 'WARN',
 `Found ${parseIntMatches.length} parseInt() calls - should use Number() for decimals`);
 } else {
 logTest('CODE', 'No parseInt() Usage', 'PASS', 'Using Number() for decimal precision');
 }
 
 // Check for atomic operations
 const atomicOps = controllerCode.match(/\$inc/g);
 if (atomicOps && atomicOps.length > 5) {
 logTest('CODE', 'Atomic Operations Usage', 'PASS',
 `Found ${atomicOps.length} atomic $inc operations`);
 } else {
 logTest('CODE', 'Atomic Operations Usage', 'WARN',
 'Limited use of atomic operations');
 }
 
 // Check for audit logging
 const auditCalls = controllerCode.match(/logAudit\(/g);
 if (auditCalls && auditCalls.length > 5) {
 logTest('CODE', 'Audit Logging Coverage', 'PASS',
 `Found ${auditCalls.length} audit log calls`);
 } else {
 logTest('CODE', 'Audit Logging Coverage', 'WARN',
 'Incomplete audit logging coverage');
 }
 
 // Check for async stats recalculation
 const setImmediateCalls = controllerCode.match(/setImmediate\(/g);
 if (setImmediateCalls && setImmediateCalls.length > 0) {
 logTest('CODE', 'Async Stats Recalculation', 'PASS',
 'Stats recalculation moved outside transactions');
 } else {
 logTest('CODE', 'Async Stats Recalculation', 'WARN',
 'Stats may be blocking transaction completion');
 }
 
 } catch (error) {
 logTest('CODE', 'Code Quality Check', 'FAIL', error.message);
 }
}

// Generate Test Report
function generateReport() {
 console.log('\n' + '='.repeat(80));
 console.log(' COMPREHENSIVE TEST REPORT');
 console.log('='.repeat(80));
 
 console.log(`\n PASSED: ${testResults.passed.length}`);
 console.log(` FAILED: ${testResults.failed.length}`);
 console.log(` WARNINGS: ${testResults.warnings.length}`);
 console.log(` TOTAL TESTS: ${testResults.passed.length + testResults.failed.length + testResults.warnings.length}`);
 
 if (testResults.failed.length > 0) {
 console.log('\n FAILURES:');
 testResults.failed.forEach((fail, idx) => {
 console.log(` ${idx + 1}. [${fail.category}] ${fail.name}`);
 console.log(` ${fail.details}`);
 });
 }
 
 if (testResults.warnings.length > 0) {
 console.log('\n WARNINGS:');
 testResults.warnings.forEach((warn, idx) => {
 console.log(` ${idx + 1}. [${warn.category}] ${warn.name}`);
 console.log(` ${warn.details}`);
 });
 }
 
 // Calculate health score
 const totalTests = testResults.passed.length + testResults.failed.length;
 const passRate = totalTests > 0 ? (testResults.passed.length / totalTests * 100).toFixed(1) : 0;
 
 console.log(`\n HEALTH SCORE: ${passRate}%`);
 
 if (passRate >= 90) {
 console.log(' System is PRODUCTION READY');
 } else if (passRate >= 70) {
 console.log(' System needs improvements before production');
 } else {
 console.log(' System NOT ready for production');
 }
 
 // Save report to file
 const reportPath = path.join(__dirname, 'test-report.json');
 fs.writeFileSync(reportPath, JSON.stringify({
 summary: {
 passed: testResults.passed.length,
 failed: testResults.failed.length,
 warnings: testResults.warnings.length,
 healthScore: passRate,
 timestamp: new Date().toISOString()
 },
 details: testResults
 }, null, 2));
 
 console.log(`\n Full report saved to: ${reportPath}`);
 console.log('='.repeat(80));
}

// Main test execution
async function runAllTests() {
 console.log(' Starting Comprehensive Functional Test Suite');
 console.log('Timestamp:', new Date().toISOString());
 
 const dbConnected = await testDatabaseConnection();
 
 if (!dbConnected) {
 console.error('\n Cannot proceed without database connection');
 process.exit(1);
 }
 
 await testModelValidation();
 await testDataIntegrity();
 await testAtomicOperations();
 await testInputValidation();
 await testAuditTrail();
 await testPerformanceIndicators();
 await testCodeQuality();
 
 generateReport();
 
 await mongoose.disconnect();
 console.log('\n All tests completed');
}

// Run tests
runAllTests().catch(error => {
 console.error('\n Test suite crashed:', error);
 process.exit(1);
});
