import 'package:investwise_android/domain/entities/user.dart';

class UserModel extends User {
  UserModel({
    required super.id,
    required super.name,
    required super.email,
    required super.role,
    super.permissions,
    super.memberId,
  });

  factory UserModel.fromJson(Map<String, dynamic> json) {
    return UserModel(
      id: json['_id'] ?? json['id'] ?? '',
      name: json['name'] ?? '',
      email: json['email'] ?? '',
      role: json['role'] ?? '',
      permissions: json['permissions'] != null
          ? Map<String, String>.from(json['permissions'])
          : null,
      memberId: json['memberId'],
    );
  }

  Map<String, dynamic> toJson() => {
        '_id': id,
        'name': name,
        'email': email,
        'role': role,
        'permissions': permissions,
        'memberId': memberId,
      };

  User toEntity() => User(
        id: id,
        name: name,
        email: email,
        role: role,
        permissions: permissions,
        memberId: memberId,
      );
}

class LoginResponse {
  final String token;
  final UserModel user;

  LoginResponse({
    required this.token,
    required this.user,
  });

  factory LoginResponse.fromJson(Map<String, dynamic> json) {
    return LoginResponse(
      token: json['token'] ?? '',
      user: UserModel.fromJson(json['user'] ?? {}),
    );
  }

  Map<String, dynamic> toJson() => {
        'token': token,
        'user': user.toJson(),
      };
}
