import 'package:investwise_android/domain/entities/global_stats.dart';

class GlobalStatsModel extends GlobalStats {
  GlobalStatsModel({
    required super.totalDeposits,
    required super.investedCapital,
    required super.totalMembers,
    required super.totalShares,
    required super.yieldIndex,
    required super.fundStability,
    required super.trendData,
    required super.topInvestor,
  });

  factory GlobalStatsModel.fromJson(Map<String, dynamic> json) {
    return GlobalStatsModel(
      totalDeposits: (json['totalDeposits'] ?? 0).toDouble(),
      investedCapital: (json['investedCapital'] ?? 0).toDouble(),
      totalMembers: json['totalMembers'] ?? 0,
      totalShares: json['totalShares'] ?? 0,
      yieldIndex: (json['yieldIndex'] ?? 0).toDouble(),
      fundStability: (json['fundStability'] ?? 100).toDouble(),
      trendData: (json['trendData'] as List?)
              ?.map((e) =>
                  TrendDataPointModel.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      topInvestor: TopInvestorModel.fromJson(
        json['topInvestor'] ?? {'name': 'N/A', 'role': 'N/A'},
      ),
    );
  }

  Map<String, dynamic> toJson() => {
        'totalDeposits': totalDeposits,
        'investedCapital': investedCapital,
        'totalMembers': totalMembers,
        'totalShares': totalShares,
        'yieldIndex': yieldIndex,
        'fundStability': fundStability,
        'trendData': trendData
            .map((e) => TrendDataPointModel.fromEntity(e).toJson())
            .toList(),
        'topInvestor': TopInvestorModel.fromEntity(topInvestor).toJson(),
      };

  GlobalStats toEntity() => GlobalStats(
        totalDeposits: totalDeposits,
        investedCapital: investedCapital,
        totalMembers: totalMembers,
        totalShares: totalShares,
        yieldIndex: yieldIndex,
        fundStability: fundStability,
        trendData: trendData,
        topInvestor: topInvestor,
      );
}

class TrendDataPointModel extends TrendDataPoint {
  TrendDataPointModel({
    required super.month,
    required super.inflow,
    required super.outflow,
  });

  factory TrendDataPointModel.fromJson(Map<String, dynamic> json) {
    return TrendDataPointModel(
      month: json['month'] ?? '',
      inflow: (json['inflow'] ?? 0).toDouble(),
      outflow: (json['outflow'] ?? 0).toDouble(),
    );
  }

  factory TrendDataPointModel.fromEntity(TrendDataPoint entity) {
    return TrendDataPointModel(
      month: entity.month,
      inflow: entity.inflow,
      outflow: entity.outflow,
    );
  }

  Map<String, dynamic> toJson() => {
        'month': month,
        'inflow': inflow,
        'outflow': outflow,
      };
}

class TopInvestorModel extends TopInvestor {
  TopInvestorModel({
    required super.name,
    required super.role,
  });

  factory TopInvestorModel.fromJson(Map<String, dynamic> json) {
    return TopInvestorModel(
      name: json['name'] ?? 'N/A',
      role: json['role'] ?? 'N/A',
    );
  }

  factory TopInvestorModel.fromEntity(TopInvestor entity) {
    return TopInvestorModel(
      name: entity.name,
      role: entity.role,
    );
  }

  Map<String, dynamic> toJson() => {
        'name': name,
        'role': role,
      };
}
