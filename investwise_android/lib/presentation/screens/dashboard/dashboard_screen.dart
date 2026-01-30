import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:fl_chart/fl_chart.dart';
import '../../providers/dashboard_provider.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/dashboard/stat_card.dart';
import '../../widgets/common/app_drawer.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_routes.dart';
import '../../../core/utils/formatters.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      if (!mounted) return;
      context.read<DashboardProvider>().loadStats();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Dashboard'),
        actions: [
          IconButton(
            icon: const Icon(Icons.sync),
            onPressed: () {
              context.read<DashboardProvider>().loadStats();
            },
          ),
        ],
      ),
      drawer: const AppDrawer(),
      body: Consumer<DashboardProvider>(
        builder: (context, provider, child) {
          if (provider.isLoading && provider.stats == null) {
            return const Center(child: CircularProgressIndicator());
          }

          if (provider.error != null && provider.stats == null) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(
                    Icons.error_outline,
                    size: 64,
                    color: AppColors.error,
                  ),
                  const SizedBox(height: 16),
                  Text(provider.error!),
                  const SizedBox(height: 16),
                  ElevatedButton(
                    onPressed: () => provider.loadStats(),
                    child: const Text('Retry'),
                  ),
                ],
              ),
            );
          }

          final stats = provider.stats!;

          return RefreshIndicator(
            onRefresh: () => provider.loadStats(),
            child: SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Welcome Section
                  Consumer<AuthProvider>(
                    builder: (context, authProvider, child) {
                      return Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Welcome back,',
                            style: TextStyle(
                              fontSize: 16,
                              color: AppColors.grey600,
                            ),
                          ),
                          Text(
                            authProvider.currentUser?.name ?? 'User',
                            style: const TextStyle(
                              fontSize: 28,
                              fontWeight: FontWeight.bold,
                              color: AppColors.dark,
                            ),
                          ),
                          const SizedBox(height: 24),
                        ],
                      );
                    },
                  ),

                  // Stats Grid
                  GridView.count(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    crossAxisCount: 2,
                    mainAxisSpacing: 16,
                    crossAxisSpacing: 16,
                    childAspectRatio: 1.1,
                    children: [
                      StatCard(
                        title: 'Total Deposits',
                        value: AppFormatters.formatCompactNumber(
                            stats.totalDeposits),
                        icon: Icons.account_balance_wallet,
                        color: AppColors.info,
                        subtitle: 'BDT',
                      ),
                      StatCard(
                        title: 'Invested Capital',
                        value: AppFormatters.formatCompactNumber(
                            stats.investedCapital),
                        icon: Icons.trending_up,
                        color: AppColors.success,
                        subtitle: 'BDT',
                      ),
                      StatCard(
                        title: 'Total Members',
                        value: '${stats.totalMembers}',
                        icon: Icons.people,
                        color: AppColors.warning,
                      ),
                      StatCard(
                        title: 'Yield Index',
                        value: '${stats.yieldIndex.toStringAsFixed(1)}%',
                        icon: Icons.analytics,
                        color: Colors.purple,
                      ),
                    ],
                  ),

                  const SizedBox(height: 24),

                  // Fund Stability
                  Container(
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(16),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.05),
                          blurRadius: 10,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text(
                              'Fund Stability',
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                                color: AppColors.dark,
                              ),
                            ),
                            Text(
                              '${stats.fundStability.toStringAsFixed(1)}%',
                              style: const TextStyle(
                                fontSize: 24,
                                fontWeight: FontWeight.bold,
                                color: AppColors.success,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: LinearProgressIndicator(
                            value: stats.fundStability / 100,
                            backgroundColor: AppColors.grey200,
                            valueColor: AlwaysStoppedAnimation<Color>(
                              stats.fundStability >= 80
                                  ? AppColors.success
                                  : stats.fundStability >= 50
                                      ? AppColors.warning
                                      : AppColors.error,
                            ),
                            minHeight: 12,
                          ),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 24),

                  // Cash Flow Chart
                  if (stats.trendData.isNotEmpty) ...[
                    const Text(
                      'Cash Flow Trend',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                        color: AppColors.dark,
                      ),
                    ),
                    const SizedBox(height: 16),
                    Container(
                      height: 250,
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(16),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.05),
                            blurRadius: 10,
                            offset: const Offset(0, 4),
                          ),
                        ],
                      ),
                      child: LineChart(
                        LineChartData(
                          gridData: const FlGridData(show: false),
                          titlesData: FlTitlesData(
                            leftTitles: const AxisTitles(
                              sideTitles: SideTitles(showTitles: false),
                            ),
                            rightTitles: const AxisTitles(
                              sideTitles: SideTitles(showTitles: false),
                            ),
                            topTitles: const AxisTitles(
                              sideTitles: SideTitles(showTitles: false),
                            ),
                            bottomTitles: AxisTitles(
                              sideTitles: SideTitles(
                                showTitles: true,
                                interval: 1,
                                getTitlesWidget: (value, meta) {
                                  if (value.toInt() >= 0 &&
                                      value.toInt() < stats.trendData.length) {
                                    final month =
                                        stats.trendData[value.toInt()].month;
                                    return Padding(
                                      padding: const EdgeInsets.only(top: 8),
                                      child: Text(
                                        month.split(' ')[0],
                                        style: const TextStyle(fontSize: 10),
                                      ),
                                    );
                                  }
                                  return const Text('');
                                },
                              ),
                            ),
                          ),
                          borderData: FlBorderData(show: false),
                          lineBarsData: [
                            // Inflow line
                            LineChartBarData(
                              spots: stats.trendData
                                  .asMap()
                                  .entries
                                  .map((e) => FlSpot(
                                        e.key.toDouble(),
                                        e.value.inflow,
                                      ))
                                  .toList(),
                              isCurved: true,
                              color: AppColors.success,
                              barWidth: 3,
                              dotData: const FlDotData(show: false),
                            ),
                            // Outflow line
                            LineChartBarData(
                              spots: stats.trendData
                                  .asMap()
                                  .entries
                                  .map((e) => FlSpot(
                                        e.key.toDouble(),
                                        e.value.outflow,
                                      ))
                                  .toList(),
                              isCurved: true,
                              color: AppColors.error,
                              barWidth: 3,
                              dotData: const FlDotData(show: false),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],

                  const SizedBox(height: 24),

                  // Quick Actions
                  const Text(
                    'Quick Actions',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                      color: AppColors.dark,
                    ),
                  ),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Expanded(
                        child: _QuickActionButton(
                          icon: Icons.people,
                          label: 'Members',
                          onTap: () {
                            Navigator.pushNamed(context, AppRoutes.members);
                          },
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: _QuickActionButton(
                          icon: Icons.folder,
                          label: 'Projects',
                          onTap: () {
                            Navigator.pushNamed(context, AppRoutes.projects);
                          },
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

class _QuickActionButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const _QuickActionButton({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 20),
        decoration: BoxDecoration(
          color: AppColors.brand.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.brand.withValues(alpha: 0.3)),
        ),
        child: Column(
          children: [
            Icon(icon, color: AppColors.dark, size: 32),
            const SizedBox(height: 8),
            Text(
              label,
              style: const TextStyle(
                fontWeight: FontWeight.w600,
                color: AppColors.dark,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
