class Fund {
  final String id;
  final String name;
  final String type;
  final String status;
  final String currency;
  final double balance;
  final String? description;
  final String? linkedProjectId;

  Fund({
    required this.id,
    required this.name,
    required this.type,
    required this.status,
    required this.currency,
    required this.balance,
    this.description,
    this.linkedProjectId,
  });

  bool get isActive => status == 'ACTIVE';
  bool get isProjectFund => type == 'PROJECT';
  bool get isDepositFund => type == 'DEPOSIT' || type == 'Primary';
}
