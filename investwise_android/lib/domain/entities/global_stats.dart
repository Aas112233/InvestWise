class GlobalStats {
  final double totalDeposits;
  final double investedCapital;
  final int totalMembers;
  final int totalShares;
  final double yieldIndex;
  final double fundStability;
  final List<TrendDataPoint> trendData;
  final TopInvestor topInvestor;

  GlobalStats({
    required this.totalDeposits,
    required this.investedCapital,
    required this.totalMembers,
    required this.totalShares,
    required this.yieldIndex,
    required this.fundStability,
    required this.trendData,
    required this.topInvestor,
  });
}

class TrendDataPoint {
  final String month;
  final double inflow;
  final double outflow;

  TrendDataPoint({
    required this.month,
    required this.inflow,
    required this.outflow,
  });
}

class TopInvestor {
  final String name;
  final String role;

  TopInvestor({
    required this.name,
    required this.role,
  });
}
