import mongoose from 'mongoose';

const GlobalStatsSchema = new mongoose.Schema({
    totalDeposits: { type: Number, default: 0 },
    investedCapital: { type: Number, default: 0 },
    totalMembers: { type: Number, default: 0 },
    totalShares: { type: Number, default: 0 },
    yieldIndex: { type: Number, default: 0 },

    // Monthly trend data for the chart (last 12 months)
    trendData: [{
        month: String, // e.g. "Jan 2024"
        inflow: { type: Number, default: 0 },
        outflow: { type: Number, default: 0 }
    }],

    // Sector distribution for the pie chart
    sectorDiversification: [{
        category: String,
        value: { type: Number, default: 0 }
    }],

    fundStability: { type: Number, default: 100 },

    lastUpdated: { type: Date, default: Date.now }
}, { timestamps: true });

const GlobalStats = mongoose.model('GlobalStats', GlobalStatsSchema);
export default GlobalStats;
