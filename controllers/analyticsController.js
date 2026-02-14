import asyncHandler from 'express-async-handler';
import GlobalStats from '../models/GlobalStats.js';
import Member from '../models/Member.js';
import Project from '../models/Project.js';
import Transaction from '../models/Transaction.js';

// @desc    Get global statistics for dashboard
// @route   GET /api/analytics/stats
// @access  Private
const getStats = asyncHandler(async (req, res) => {
    let stats = await GlobalStats.findOne();

    // If no stats exist yet, create initial one
    if (!stats) {
        stats = await recalculateAllStats();
    }

    res.json(stats);
});

// @desc    Manually trigger stats recalculation
// @route   POST /api/analytics/recalculate
// @access  Private (Admin)
const triggerRecalculate = asyncHandler(async (req, res) => {
    const stats = await recalculateAllStats();
    res.json({ message: 'Stats recalculated successfully', stats });
});

/**
 * Utility function to perform heavy aggregations and update the GlobalStats document
 * This can be called from controllers when data changes
 */
const recalculateAllStats = async () => {
    const totalMembers = await Member.countDocuments({ status: 'active' });

    const projectAggregation = await Project.aggregate([
        {
            $group: {
                _id: null,
                investedCapital: { $sum: '$initialInvestment' },
                avgYield: { $avg: { $toDouble: '$projectedReturn' } }
            }
        }
    ]);

    const memberAggregation = await Member.aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: null, totalShares: { $sum: '$shares' } } }
    ]);

    const transactionAggregation = await Transaction.aggregate([
        { $match: { status: { $in: ['Success', 'Completed'] } } },
        {
            $group: {
                _id: null,
                totalDeposits: {
                    $sum: {
                        $cond: [{ $in: ['$type', ['Deposit', 'Earning']] }, '$amount', 0]
                    }
                }
            }
        }
    ]);

    // Trend Data (Last 6 Months)
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(d);
    }

    const trendData = await Promise.all(months.map(async (monthStart) => {
        const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23, 59, 59);
        const monthName = monthStart.toLocaleString('default', { month: 'short' });

        const monthlyStats = await Transaction.aggregate([
            {
                $match: {
                    date: { $gte: monthStart, $lte: monthEnd },
                    status: { $in: ['Success', 'Completed'] }
                }
            },
            {
                $group: {
                    _id: null,
                    inflow: { $sum: { $cond: [{ $in: ['$type', ['Deposit', 'Earning', 'Investment']] }, '$amount', 0] } },
                    outflow: { $sum: { $cond: [{ $in: ['$type', ['Expense', 'Withdrawal', 'Dividend']] }, '$amount', 0] } }
                }
            }
        ]);

        return {
            month: monthName,
            inflow: monthlyStats[0]?.inflow || 0,
            outflow: monthlyStats[0]?.outflow || 0
        };
    }));

    // Sector Distribution
    const sectorDiversification = await Project.aggregate([
        {
            $group: {
                _id: '$category',
                value: { $sum: '$initialInvestment' }
            }
        },
        { $project: { _id: 0, category: '$_id', value: 1 } }
    ]);

    // Top Partners by shares for Radar Chart
    const topPartners = await Member.find({ status: 'active' })
        .sort({ shares: -1 })
        .limit(6)
        .select('name shares');

    const maxShares = topPartners.length > 0 ? topPartners[0].shares : 100;

    // Top Projects by ROI for Efficiency Matrix
    const topProjects = await Project.find({})
        .sort({ projectedReturn: -1 })
        .limit(4)
        .select('title projectedReturn');

    const formattedTopProjects = topProjects.map(p => ({
        title: p.title,
        roi: parseFloat(p.projectedReturn) || 0
    }));

    // Top Investor for the summary card
    const topInvestor = topPartners.length > 0
        ? { name: topPartners[0].name, role: 'Principal Partner' }
        : { name: 'N/A', role: 'N/A' };

    // Calculate Fund Stability (NAV Ratio)
    // Assets = Invested Capital + Cash Balance
    // Liabilities = Total Deposits

    const cashFlowParams = await Transaction.aggregate([
        { $match: { status: { $in: ['Success', 'Completed'] } } },
        {
            $group: {
                _id: null,
                totalInflow: { $sum: { $cond: [{ $in: ['$type', ['Deposit', 'Earning', 'Investment', 'Dividend']] }, '$amount', 0] } },
                totalOutflow: { $sum: { $cond: [{ $in: ['$type', ['Withdrawal', 'Expense']] }, '$amount', 0] } }
            }
        }
    ]);

    const totalDepositsVal = transactionAggregation[0]?.totalDeposits || 1; // Avoid division by zero
    const totalInflow = cashFlowParams[0]?.totalInflow || 0;
    const totalOutflow = cashFlowParams[0]?.totalOutflow || 0;
    const cashBalance = totalInflow - totalOutflow - (projectAggregation[0]?.investedCapital || 0);

    // NAV Ratio = (Invested Capital + Cash Balance) / Total Deposits * 100
    // Simplified: (Total Assets / Total Liabilities) * 100
    // Note: This approximates the "Are we solvent?" question
    const totalAssets = (projectAggregation[0]?.investedCapital || 0) + Math.max(0, cashBalance);
    const fundStability = Math.min(100, (totalAssets / totalDepositsVal) * 100).toFixed(1);

    const statsData = {
        totalMembers,
        investedCapital: projectAggregation[0]?.investedCapital || 0,
        totalShares: memberAggregation[0]?.totalShares || 0,
        totalDeposits: transactionAggregation[0]?.totalDeposits || 0,
        yieldIndex: projectAggregation[0]?.avgYield || 0,
        trendData,
        sectorDiversification,
        topPartners,
        maxShares,
        topProjects: formattedTopProjects,
        topInvestor,
        fundStability,
        lastUpdated: new Date()
    };

    return await GlobalStats.findOneAndUpdate({}, statsData, { upsert: true, new: true });
};

export { getStats, triggerRecalculate, recalculateAllStats };
