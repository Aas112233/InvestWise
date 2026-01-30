import 'package:flutter/material.dart';
import 'package:investwise_android/core/constants/app_colors.dart';
import 'package:investwise_android/core/utils/formatters.dart';
import 'package:investwise_android/domain/entities/project.dart';

class ProjectCard extends StatelessWidget {
  final Project project;
  final VoidCallback onTap;

  const ProjectCard({
    super.key,
    required this.project,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: AppColors.grey200),
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header: Category Badge and Status
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppColors.brand.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      project.category,
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: AppColors.dark,
                      ),
                    ),
                  ),
                  _StatusBadge(status: project.status),
                ],
              ),
              const SizedBox(height: 12),

              // Title and Description
              Text(
                project.title,
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                  color: AppColors.dark,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 4),
              Text(
                project.description,
                style: const TextStyle(
                  fontSize: 14,
                  color: AppColors.grey600,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 16),

              // Progress Bar
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    '${project.budgetProgress.toStringAsFixed(0)}%',
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                      color: AppColors.dark,
                    ),
                  ),
                  Text(
                    'Target: ${AppFormatters.formatCompactNumber(project.budget)}',
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppColors.grey500,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: LinearProgressIndicator(
                  value: project.budgetProgress / 100,
                  backgroundColor: AppColors.grey200,
                  valueColor: AlwaysStoppedAnimation<Color>(
                    project.budgetProgress >= 100
                        ? AppColors.success
                        : AppColors.brand,
                  ),
                  minHeight: 8,
                ),
              ),
              const SizedBox(height: 16),

              // Footer: Finances and Health
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Total Value',
                        style: TextStyle(
                          fontSize: 12,
                          color: AppColors.grey500,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        AppFormatters.formatCurrency(project.currentValue),
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          color: AppColors.primary,
                        ),
                      ),
                    ],
                  ),
                  _HealthBadge(health: project.health),
                ],
              ),
            ],
          ),
        ),
      ),
    );
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

    return Row(
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(
            color: color,
            shape: BoxShape.circle,
          ),
        ),
        const SizedBox(width: 6),
        Text(
          status,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w500,
            color: color,
          ),
        ),
      ],
    );
  }
}

class _HealthBadge extends StatelessWidget {
  final String health;

  const _HealthBadge({required this.health});

  @override
  Widget build(BuildContext context) {
    Color bgColor;
    Color textColor;

    switch (health) {
      case 'Stable':
        bgColor = AppColors.success.withValues(alpha: 0.1);
        textColor = AppColors.success;
        break;
      case 'At Risk':
        bgColor = AppColors.warning.withValues(alpha: 0.1);
        textColor = AppColors.warning;
        break;
      case 'Critical':
        bgColor = AppColors.error.withValues(alpha: 0.1);
        textColor = AppColors.error;
        break;
      default:
        bgColor = AppColors.grey200;
        textColor = AppColors.grey600;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Icon(
            health == 'Stable'
                ? Icons.check_circle_outline
                : health == 'At Risk'
                    ? Icons.warning_amber_rounded
                    : Icons.error_outline,
            size: 14,
            color: textColor,
          ),
          const SizedBox(width: 4),
          Text(
            health,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: textColor,
            ),
          ),
        ],
      ),
    );
  }
}
