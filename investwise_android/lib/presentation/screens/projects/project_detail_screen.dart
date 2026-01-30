import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:investwise_android/core/constants/app_colors.dart';
import 'package:investwise_android/core/utils/formatters.dart';
import 'package:investwise_android/domain/entities/project.dart';
import 'package:investwise_android/presentation/providers/project_provider.dart';

class ProjectDetailScreen extends StatefulWidget {
  const ProjectDetailScreen({super.key});

  @override
  State<ProjectDetailScreen> createState() => _ProjectDetailScreenState();
}

class _ProjectDetailScreenState extends State<ProjectDetailScreen> {
  final _amountController = TextEditingController();
  final _descriptionController = TextEditingController();
  String _updateType = 'Earning';

  @override
  void dispose() {
    _amountController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  void _showAddUpdateDialog(String projectId) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Add Project Update'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            DropdownButtonFormField<String>(
              initialValue: _updateType,
              items: ['Earning', 'Expense']
                  .map((t) => DropdownMenuItem(value: t, child: Text(t)))
                  .toList(),
              onChanged: (v) => setState(() => _updateType = v!),
              decoration: const InputDecoration(labelText: 'Type'),
            ),
            TextField(
              controller: _amountController,
              decoration: const InputDecoration(labelText: 'Amount'),
              keyboardType: TextInputType.number,
            ),
            TextField(
              controller: _descriptionController,
              decoration: const InputDecoration(labelText: 'Description'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () async {
              final success =
                  await context.read<ProjectProvider>().addProjectUpdate(
                projectId,
                {
                  'type': _updateType,
                  'amount': double.tryParse(_amountController.text) ?? 0,
                  'description': _descriptionController.text,
                },
              );
              if (success && context.mounted) {
                _amountController.clear();
                _descriptionController.clear();
                Navigator.pop(context);
              }
            },
            child: const Text('Add'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // Get project ID from arguments
    final initialProject =
        ModalRoute.of(context)!.settings.arguments as Project;

    return Consumer<ProjectProvider>(
      builder: (context, provider, child) {
        // Find the latest version of this project from the provider
        final project = provider.projects.firstWhere(
          (p) => p.id == initialProject.id,
          orElse: () => initialProject,
        );

        return Scaffold(
          body: CustomScrollView(
            slivers: [
              // 1. Hero Header
              SliverAppBar(
                expandedHeight: 200.0,
                floating: false,
                pinned: true,
                backgroundColor: AppColors.primary,
                flexibleSpace: FlexibleSpaceBar(
                  title: Text(
                    project.title,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 16.0,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  background: Container(
                    decoration: const BoxDecoration(
                      gradient: LinearGradient(
                        colors: [AppColors.primary, AppColors.dark],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                    ),
                    child: Center(
                      child: Icon(
                        Icons.business_center,
                        size: 80,
                        color: Colors.white.withValues(alpha: 0.2),
                      ),
                    ),
                  ),
                ),
              ),

              // 2. Content Body
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Category & Status
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 12, vertical: 6),
                            decoration: BoxDecoration(
                              color: AppColors.brand.withValues(alpha: 0.1),
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: Text(
                              project.category,
                              style: const TextStyle(
                                color: AppColors.dark,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                          const Spacer(),
                          _StatusBadge(status: project.status),
                        ],
                      ),
                      const SizedBox(height: 24),

                      // Overall Progress
                      const Text(
                        'Budget Progress',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 8),
                      _buildProgressBar(project),

                      const SizedBox(height: 24),

                      // Health & ROI
                      Row(
                        children: [
                          Expanded(
                            child: _StatCard(
                              label: 'Health',
                              value: project.health,
                              valueColor: _getHealthColor(project.health),
                              icon: Icons.monitor_heart,
                            ),
                          ),
                          const SizedBox(width: 16),
                          Expanded(
                            child: _StatCard(
                              label: 'Expected ROI',
                              value: '${project.expectedRoi}%',
                              icon: Icons.trending_up,
                            ),
                          ),
                        ],
                      ),

                      const SizedBox(height: 16),

                      // Financial Stats Grid
                      _buildFinancialGrid(project),

                      const SizedBox(height: 24),

                      // Description
                      const Text(
                        'Description',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        project.description,
                        style: const TextStyle(
                          color: AppColors.grey700,
                          height: 1.5,
                        ),
                      ),

                      const SizedBox(height: 24),

                      // Updates Timeline
                      const Text(
                        'Recent Activity',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 16),
                      _buildUpdatesTimeline(project.updates),

                      // Bottom Padding
                      const SizedBox(height: 40),
                    ],
                  ),
                ),
              ),
            ],
          ),
          floatingActionButton: FloatingActionButton(
            onPressed: () => _showAddUpdateDialog(project.id),
            backgroundColor: AppColors.brand,
            child: const Icon(Icons.add, color: AppColors.dark),
          ),
        );
      },
    );
  }

  Widget _buildProgressBar(Project project) {
    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              '${project.budgetProgress.toStringAsFixed(0)}%',
              style: const TextStyle(fontWeight: FontWeight.bold),
            ),
            Text(
              '${AppFormatters.formatCompactNumber(project.currentValue)} / ${AppFormatters.formatCompactNumber(project.budget)}',
              style: const TextStyle(color: AppColors.grey600),
            ),
          ],
        ),
        const SizedBox(height: 8),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(
            value: project.budgetProgress / 100,
            minHeight: 12,
            backgroundColor: AppColors.grey200,
            valueColor: AlwaysStoppedAnimation(
              project.budgetProgress >= 100
                  ? AppColors.success
                  : AppColors.brand,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildFinancialGrid(Project project) {
    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: _StatCard(
                label: 'Initial Investment',
                value: AppFormatters.formatCompactNumber(
                    project.initialInvestment),
                icon: Icons.monetization_on_outlined,
              ),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: _StatCard(
                label: 'Total Shares',
                value: project.totalShares.toString(),
                icon: Icons.pie_chart_outline,
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        Row(
          children: [
            Expanded(
              child: _StatCard(
                label: 'Total Earnings',
                value: AppFormatters.formatCompactNumber(project.totalEarnings),
                valueColor: AppColors.success,
                icon: Icons.arrow_upward,
              ),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: _StatCard(
                label: 'Total Expenses',
                value: AppFormatters.formatCompactNumber(project.totalExpenses),
                valueColor: AppColors.error,
                icon: Icons.arrow_downward,
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildUpdatesTimeline(List<ProjectUpdate> updates) {
    if (updates.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(16.0),
          child: Text('No updates yet'),
        ),
      );
    }

    // Sort updates by date descending
    final sortedUpdates = List<ProjectUpdate>.from(updates)
      ..sort((a, b) => b.date.compareTo(a.date));

    return ListView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: sortedUpdates.length,
      itemBuilder: (context, index) {
        final update = sortedUpdates[index];
        return Padding(
          padding: const EdgeInsets.only(bottom: 16.0),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Timeline Line & Dot
              Column(
                children: [
                  Container(
                    width: 12,
                    height: 12,
                    decoration: BoxDecoration(
                      color: update.isEarning
                          ? AppColors.success
                          : AppColors.error,
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 2),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.grey.withValues(alpha: 0.2),
                          spreadRadius: 1,
                          blurRadius: 2,
                        ),
                      ],
                    ),
                  ),
                  if (index != sortedUpdates.length - 1)
                    Container(
                      width: 2,
                      height: 50, // Approximate height for line
                      color: AppColors.grey200,
                    ),
                ],
              ),
              const SizedBox(width: 16),
              // Content
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          update.type,
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            color: update.isEarning
                                ? AppColors.success
                                : AppColors.error,
                          ),
                        ),
                        Text(
                          AppFormatters.formatDate(update.date),
                          style: const TextStyle(
                            fontSize: 12,
                            color: AppColors.grey500,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      update.description,
                      style: const TextStyle(color: AppColors.dark),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      AppFormatters.formatCurrency(update.amount),
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 14,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Color _getHealthColor(String health) {
    if (health == 'Stable') return AppColors.success;
    if (health == 'At Risk') return AppColors.warning;
    return AppColors.error;
  }
}

class _StatusBadge extends StatelessWidget {
  final String status;

  const _StatusBadge({required this.status});

  @override
  Widget build(BuildContext context) {
    Color color;
    switch (status) {
      case 'Completed':
        color = AppColors.success;
        break;
      case 'In Progress':
        color = AppColors.info;
        break;
      case 'Review':
        color = AppColors.warning;
        break;
      default:
        color = AppColors.grey500;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        status,
        style: TextStyle(
          color: color,
          fontWeight: FontWeight.bold,
          fontSize: 12,
        ),
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final String label;
  final String value;
  final Color? valueColor;
  final IconData icon;

  const _StatCard({
    required this.label,
    required this.value,
    this.valueColor,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.grey200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: AppColors.grey500),
          const SizedBox(height: 8),
          Text(
            value,
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.bold,
              color: valueColor ?? AppColors.dark,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            style: const TextStyle(
              fontSize: 12,
              color: AppColors.grey500,
            ),
          ),
        ],
      ),
    );
  }
}
