import 'package:investwise_android/domain/entities/member.dart';

class MemberModel extends Member {
  MemberModel({
    required super.id,
    required super.memberId,
    required super.name,
    required super.email,
    required super.phone,
    required super.role,
    required super.shares,
    required super.totalContributed,
    required super.status,
    super.avatar,
  });

  factory MemberModel.fromJson(Map<String, dynamic> json) {
    return MemberModel(
      id: json['_id'] ?? json['id'] ?? '',
      memberId: json['memberId'] ?? '',
      name: json['name'] ?? '',
      email: json['email'] ?? '',
      phone: json['phone'] ?? '',
      role: json['role'] ?? '',
      shares: json['shares'] ?? 0,
      totalContributed: (json['totalContributed'] ?? 0).toDouble(),
      status: json['status'] ?? 'Active',
      avatar: json['avatar'],
    );
  }

  Map<String, dynamic> toJson() => {
        '_id': id,
        'memberId': memberId,
        'name': name,
        'email': email,
        'phone': phone,
        'role': role,
        'shares': shares,
        'totalContributed': totalContributed,
        'status': status,
        'avatar': avatar,
      };

  Member toEntity() => Member(
        id: id,
        memberId: memberId,
        name: name,
        email: email,
        phone: phone,
        role: role,
        shares: shares,
        totalContributed: totalContributed,
        status: status,
        avatar: avatar,
      );
}
