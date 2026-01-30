import 'package:investwise_android/domain/entities/fund.dart';

class FundModel extends Fund {
  FundModel({
    required super.id,
    required super.name,
    required super.type,
    required super.status,
    required super.currency,
    required super.balance,
    super.description,
    super.linkedProjectId,
  });

  factory FundModel.fromJson(Map<String, dynamic> json) {
    return FundModel(
      id: json['_id'] ?? '',
      name: json['name'] ?? '',
      type: json['type'] ?? 'OTHER',
      status: json['status'] ?? 'ACTIVE',
      currency: json['currency'] ?? 'BDT',
      balance: (json['balance'] ?? 0).toDouble(),
      description: json['description'],
      linkedProjectId: json['linkedProjectId'],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      'type': type,
      'status': status,
      'currency': currency,
      'balance': balance,
      'description': description,
      'linkedProjectId': linkedProjectId,
    };
  }

  Fund toEntity() => this;
}
