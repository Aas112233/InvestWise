class Project {
  final String id;
  final String title;
  final String category;
  final String description;
  final double initialInvestment;
  final double budget;
  final double expectedRoi;
  final int totalShares;
  final String status; // 'In Progress', 'Completed', 'Review'
  final String health; // 'Stable', 'At Risk', 'Critical'
  final DateTime startDate;
  final DateTime? completionDate;
  final double totalEarnings;
  final double totalExpenses;
  final double currentValue;
  final List<ProjectUpdate> updates;
  final DateTime createdAt;
  final DateTime updatedAt;

  const Project({
    required this.id,
    required this.title,
    required this.category,
    required this.description,
    required this.initialInvestment,
    required this.budget,
    required this.expectedRoi,
    required this.totalShares,
    required this.status,
    required this.health,
    required this.startDate,
    this.completionDate,
    required this.totalEarnings,
    required this.totalExpenses,
    required this.currentValue,
    required this.updates,
    required this.createdAt,
    required this.updatedAt,
  });

  // Computed properties for UI
  double get budgetProgress => budget > 0 ? (currentValue / budget) * 100 : 0;
  double get netProfit => totalEarnings - totalExpenses;
  bool get isCompleted => status == 'Completed';
  bool get isHealthy => health == 'Stable';
  bool get isAtRisk => health == 'At Risk';
  bool get isCritical => health == 'Critical';
}

class ProjectUpdate {
  final String? id;
  final String type; // 'Earning', 'Expense'
  final double amount;
  final String description;
  final DateTime date;

  const ProjectUpdate({
    this.id,
    required this.type,
    required this.amount,
    required this.description,
    required this.date,
  });

  bool get isEarning => type == 'Earning';
  bool get isExpense => type == 'Expense';
}
