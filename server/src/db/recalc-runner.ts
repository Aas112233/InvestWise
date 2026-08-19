import { connectDB } from '../config/database.js';
import { recalculateAllStats } from '../modules/analytics/service.js';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  await connectDB();
  const stats = await recalculateAllStats();
  console.log('[OK] Analytics recalculation complete!');
  console.log('Summary:');
  console.log('  Total Members:     ', stats.totalMembers);
  console.log('  Invested Capital:  ', stats.investedCapital);
  console.log('  Total Deposits:    ', stats.totalDeposits);
  console.log('  Yield Index:       ', stats.yieldIndex);
  console.log('  Fund Stability:    ', stats.fundStability);
  console.log('  Trend Data Points: ', stats.trendData.length);
  console.log('  Sectors:           ', stats.sectorDiversification.map(s => `${s.category}: ${s.value}`).join(', '));
  console.log('  Governance:        ', stats.governance);
  process.exit(0);
}

run().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
