class Transaction {
  final String id;
  final String
      type; // Deposit, Withdrawal, Investment, Expense, Earning, Dividend, Equity-Transfer, Adjustment, Transfer
  final double amount;
  final String description;
  final String? category;
  final DateTime date;
  final String
      status; // Success, Processing, Failed, Pending, Flagged, Completed
  final String? memberId;
  final String? projectId;
  final String? fundId;
  final String? handlingOfficer;
  final String? depositMethod;
  final String? authorizedBy;

  const Transaction({
    required this.id,
    required this.type,
    required this.amount,
    required this.description,
    this.category,
    required this.date,
    required this.status,
    this.memberId,
    this.projectId,
    this.fundId,
    this.handlingOfficer,
    this.depositMethod,
    this.authorizedBy,
  });

  bool get isInflow =>
      type == 'Deposit' ||
      type == 'Earning' ||
      type == 'Equity-Transfer' ||
      (type == 'Adjustment' && amount > 0);

  bool get isOutflow =>
      type == 'Withdrawal' ||
      type == 'Investment' ||
      type == 'Expense' ||
      type == 'Dividend' ||
      (type == 'Adjustment' && amount < 0);

  bool get isSuccess => status == 'Success' || status == 'Completed';
  bool get isProcessing => status == 'Processing' || status == 'Pending';
  bool get isFailed => status == 'Failed' || status == 'Flagged';
}
