import 'package:flutter/material.dart';
import 'package:investwise_android/core/constants/app_colors.dart';
import 'package:investwise_android/core/utils/formatters.dart';
import 'package:investwise_android/domain/entities/transaction.dart';

class TransactionCard extends StatelessWidget {
  final Transaction transaction;
  final VoidCallback? onTap;

  const TransactionCard({
    super.key,
    required this.transaction,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final isPositive = transaction.isInflow;
    final amountColor = isPositive ? AppColors.success : AppColors.error;
    final amountPrefix = isPositive ? '+' : '-';

    return Card(
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: AppColors.grey200),
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              // Type Icon
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: amountColor.withValues(alpha: 0.1),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  _getIconForType(transaction.type),
                  color: amountColor,
                  size: 20,
                ),
              ),
              const SizedBox(width: 12),

              // Description and Date
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      transaction.description,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: AppColors.dark,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${transaction.type} • ${AppFormatters.formatDate(transaction.date)}',
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.grey500,
                      ),
                    ),
                  ],
                ),
              ),

              // Amount
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    '$amountPrefix${AppFormatters.formatCurrency(transaction.amount)}',
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.bold,
                      color: amountColor,
                    ),
                  ),
                  const SizedBox(height: 2),
                  _StatusBadge(status: transaction.status),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  IconData _getIconForType(String type) {
    switch (type) {
      case 'Deposit':
        return Icons.account_balance_wallet_outlined;
      case 'Withdrawal':
        return Icons.money_off_csred_outlined;
      case 'Investment':
        return Icons.trending_up;
      case 'Expense':
        return Icons.shopping_bag_outlined;
      case 'Earning':
        return Icons.add_chart;
      case 'Dividend':
        return Icons.payments_outlined;
      case 'Equity-Transfer':
        return Icons.swap_horiz;
      case 'Adjustment':
        return Icons.tune;
      case 'Transfer':
        return Icons.multiple_stop;
      default:
        return Icons.receipt_long_outlined;
    }
  }
}

class _StatusBadge extends StatelessWidget {
  final String status;

  const _StatusBadge({required this.status});

  @override
  Widget build(BuildContext context) {
    Color color;
    switch (status) {
      case 'Success':
      case 'Completed':
        color = AppColors.success;
        break;
      case 'Processing':
      case 'Pending':
        color = AppColors.warning;
        break;
      case 'Failed':
      case 'Flagged':
        color = AppColors.error;
        break;
      default:
        color = AppColors.grey500;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        status.toUpperCase(),
        style: TextStyle(
          fontSize: 8,
          fontWeight: FontWeight.bold,
          color: color,
        ),
      ),
    );
  }
}
