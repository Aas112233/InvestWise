import asyncHandler from 'express-async-handler';
import GlobalStats from '../models/GlobalStats.js';
import Member from '../models/Member.js';
import Project from '../models/Project.js';
import Transaction from '../models/Transaction.js';
import cache from '../utils/cache.js';

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
    // Clear cached stats
    cache.del('analytics:stats');

    const stats = await recalculateAllStats();
    res.json({ message: 'Stats recalculated successfully', stats });
});

/**
 * Utility function to perform heavy aggregations and update the GlobalStats document
 * This can be called from controllers when data changes
 */
const recalculateAllStats = async () => {
    // Calculate date range for trend data
    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    // Run all aggregations in parallel for better performance
    const [
        totalMembers,
        projectAggregation,
        memberAggregation,
        transactionAggregation,
        trendAggregation,
        sectorDiversification,
        topPartners,
        topProjects,
        cashFlowParams
    ] = await Promise.all([
        Member.countDocuments({ status: 'active' }),
        Project.aggregate([
            {
                $group: {
                    _id: null,
                    investedCapital: { $sum: '$initialInvestment' },
                    avgYield: { $avg: { $toDouble: '$projectedReturn' } }
                }
            }
        ]),
        Member.aggregate([
            { $match: { status: 'active' } },
            { $group: { _id: null, totalShares: { $sum: '$shares' } } }
        ]),
        Transaction.aggregate([
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
        ]),
        Transaction.aggregate([
            {
                $match: {
                    date: { $gte: sixMonthsAgo },
                    status: { $in: ['Success', 'Completed'] }
                }
            },
            {
                $group: {
                    _id: {
                        year: { $year: '$date' },
                        month: { $month: '$date' }
                    },
                    inflow: { $sum: { $cond: [{ $in: ['$type', ['Deposit', 'Earning', 'Investment']] }, '$amount', 0] } },
                    outflow: { $sum: { $cond: [{ $in: ['$type', ['Expense', 'Withdrawal', 'Dividend']] }, '$amount', 0] } }
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } }
        ]),
        Project.aggregate([
            {
                $group: {
                    _id: '$category',
                    value: { $sum: '$initialInvestment' }
                }
            },
            { $project: { _id: 0, category: '$_id', value: 1 } }
        ]),
        Member.find({ status: 'active' }).lean().sort({ shares: -1 }).limit(6).select('name shares'),
        Project.find({}).lean().sort({ projectedReturn: -1 }).limit(4).select('title projectedReturn'),
        Transaction.aggregate([
            { $match: { status: { $in: ['Success', 'Completed'] } } },
            {
                $group: {
                    _id: null,
                    totalInflow: { $sum: { $cond: [{ $in: ['$type', ['Deposit', 'Earning', 'Investment', 'Dividend']] }, '$amount', 0] } },
                    totalOutflow: { $sum: { $cond: [{ $in: ['$type', ['Withdrawal', 'Expense']] }, '$amount', 0] } }
                }
            }
        ])
    ]);

    // Convert aggregation result to trend data format
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const trendDataMap = new Map();
    trendAggregation.forEach(item => {
        const key = `${item._id.year}-${item._id.month}`;
        trendDataMap.set(key, { inflow: item.inflow, outflow: item.outflow });
    });

    // Use 'now' from earlier declaration
    const trendData = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
        const data = trendDataMap.get(key) || { inflow: 0, outflow: 0 };
        trendData.push({
            month: monthNames[d.getMonth()],
            inflow: data.inflow,
            outflow: data.outflow
        });
    }

    // Process results from parallel queries
    const maxShares = topPartners.length > 0 ? topPartners[0].shares : 100;

    const formattedTopProjects = topProjects.map(p => ({
        title: p.title,
        roi: parseFloat(p.projectedReturn) || 0
    }));

    // Top Investor for the summary card
    const topInvestor = topPartners.length > 0
        ? { name: topPartners[0].name, role: 'Principal Partner' }
        : { name: 'N/A', role: 'N/A' };

    // Calculate Fund Stability (NAV Ratio)
    const totalDepositsVal = transactionAggregation[0]?.totalDeposits || 1;
    const totalInflow = cashFlowParams[0]?.totalInflow || 0;
    const totalOutflow = cashFlowParams[0]?.totalOutflow || 0;
    const investedCapital = projectAggregation[0]?.investedCapital || 0;
    const cashBalance = totalInflow - totalOutflow - investedCapital;

    const totalAssets = investedCapital + Math.max(0, cashBalance);
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
