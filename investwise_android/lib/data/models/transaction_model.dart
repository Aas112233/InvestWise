import 'package:investwise_android/domain/entities/transaction.dart';

class TransactionModel extends Transaction {
  const TransactionModel({
    required super.id,
    required super.type,
    required super.amount,
    required super.description,
    super.category,
    required super.date,
    required super.status,
    super.memberId,
    super.projectId,
    super.fundId,
    super.handlingOfficer,
    super.depositMethod,
    super.authorizedBy,
  });

  factory TransactionModel.fromJson(Map<String, dynamic> json) {
    return TransactionModel(
      id: json['_id'] as String,
      type: json['type'] as String,
      amount: (json['amount'] as num).toDouble(),
      description: json['description'] as String,
      category: json['category'] as String?,
      date: DateTime.parse(json['date'] as String),
      status: json['status'] as String,
      memberId: json['memberId'] as String?,
      projectId: json['projectId'] as String?,
      fundId: json['fundId'] as String?,
      handlingOfficer: json['handlingOfficer'] as String?,
      depositMethod: json['depositMethod'] as String?,
      authorizedBy: json['authorizedBy'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      '_id': id,
      'type': type,
      'amount': amount,
      'description': description,
      'category': category,
      'date': date.toIso8601String(),
      'status': status,
      'memberId': memberId,
      'projectId': projectId,
      'fundId': fundId,
      'handlingOfficer': handlingOfficer,
      'depositMethod': depositMethod,
      'authorizedBy': authorizedBy,
    };
  }

  Transaction toEntity() {
    return Transaction(
      id: id,
      type: type,
      amount: amount,
      description: description,
      category: category,
      date: date,
      status: status,
      memberId: memberId,
      projectId: projectId,
      fundId: fundId,
      handlingOfficer: handlingOfficer,
      depositMethod: depositMethod,
      authorizedBy: authorizedBy,
    );
  }
}
