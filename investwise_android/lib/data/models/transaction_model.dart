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
    // Helper to safely extract String ID or Name from dynamic value
    String? extractString(dynamic value, [String fieldName = '_id']) {
      if (value == null) return null;
      if (value is String) return value;
      if (value is Map) {
        return value[fieldName] as String? ?? value['_id'] as String?;
      }
      return value.toString();
    }

    return TransactionModel(
      id: json['_id'] as String,
      type: json['type'] as String,
      amount: (json['amount'] as num).toDouble(),
      description: json['description'] as String,
      category: extractString(json['category'], 'name'),
      date: DateTime.parse(json['date'] as String),
      status: json['status'] as String,
      memberId: extractString(json['memberId']),
      projectId: extractString(json['projectId']),
      fundId: extractString(json['fundId']),
      handlingOfficer: extractString(json['handlingOfficer'], 'name'),
      depositMethod: json['depositMethod'] as String?,
      authorizedBy: extractString(json['authorizedBy'], 'name'),
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
