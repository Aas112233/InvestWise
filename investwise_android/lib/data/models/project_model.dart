import 'package:investwise_android/domain/entities/project.dart';

class ProjectUpdateModel extends ProjectUpdate {
  const ProjectUpdateModel({
    super.id,
    required super.type,
    required super.amount,
    required super.description,
    required super.date,
  });

  factory ProjectUpdateModel.fromJson(Map<String, dynamic> json) {
    return ProjectUpdateModel(
      id: json['_id'] as String?,
      type: json['type'] as String,
      amount: (json['amount'] as num?)?.toDouble() ?? 0.0,
      description: json['description'] as String,
      date: DateTime.parse(json['date'] as String),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      if (id != null) '_id': id,
      'type': type,
      'amount': amount,
      'description': description,
      'date': date.toIso8601String(),
    };
  }

  ProjectUpdate toEntity() {
    return ProjectUpdate(
      id: id,
      type: type,
      amount: amount,
      description: description,
      date: date,
    );
  }
}

class ProjectModel extends Project {
  const ProjectModel({
    required super.id,
    required super.title,
    required super.category,
    required super.description,
    required super.initialInvestment,
    required super.budget,
    required super.expectedRoi,
    required super.totalShares,
    required super.status,
    required super.health,
    required super.startDate,
    super.completionDate,
    required super.totalEarnings,
    required super.totalExpenses,
    required super.currentValue,
    required super.updates,
    required super.createdAt,
    required super.updatedAt,
  });

  factory ProjectModel.fromJson(Map<String, dynamic> json) {
    return ProjectModel(
      id: json['_id'] as String,
      title: json['title'] as String,
      category: json['category'] as String,
      description: json['description'] as String,
      initialInvestment: (json['initialInvestment'] as num?)?.toDouble() ?? 0.0,
      budget: (json['budget'] as num?)?.toDouble() ?? 0.0,
      expectedRoi: (json['expectedRoi'] as num?)?.toDouble() ?? 0.0,
      totalShares: (json['totalShares'] as num?)?.toInt() ?? 0,
      status: json['status'] as String,
      health: json['health'] as String,
      startDate: DateTime.parse(json['startDate'] as String),
      completionDate: json['completionDate'] != null
          ? DateTime.parse(json['completionDate'] as String)
          : null,
      totalEarnings: (json['totalEarnings'] as num?)?.toDouble() ?? 0.0,
      totalExpenses: (json['totalExpenses'] as num?)?.toDouble() ?? 0.0,
      currentValue: (json['currentValue'] as num?)?.toDouble() ?? 0.0,
      updates: (json['updates'] as List<dynamic>)
          .map((update) =>
              ProjectUpdateModel.fromJson(update as Map<String, dynamic>))
          .toList(),
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      '_id': id,
      'title': title,
      'category': category,
      'description': description,
      'initialInvestment': initialInvestment,
      'budget': budget,
      'expectedRoi': expectedRoi,
      'totalShares': totalShares,
      'status': status,
      'health': health,
      'startDate': startDate.toIso8601String(),
      if (completionDate != null)
        'completionDate': completionDate!.toIso8601String(),
      'totalEarnings': totalEarnings,
      'totalExpenses': totalExpenses,
      'currentValue': currentValue,
      'updates': updates
          .map((update) => (update as ProjectUpdateModel).toJson())
          .toList(),
      'createdAt': createdAt.toIso8601String(),
      'updatedAt': updatedAt.toIso8601String(),
    };
  }

  Project toEntity() {
    return Project(
      id: id,
      title: title,
      category: category,
      description: description,
      initialInvestment: initialInvestment,
      budget: budget,
      expectedRoi: expectedRoi,
      totalShares: totalShares,
      status: status,
      health: health,
      startDate: startDate,
      completionDate: completionDate,
      totalEarnings: totalEarnings,
      totalExpenses: totalExpenses,
      currentValue: currentValue,
      updates:
          updates.map((u) => (u as ProjectUpdateModel).toEntity()).toList(),
      createdAt: createdAt,
      updatedAt: updatedAt,
    );
  }
}
