class User {
  final String id;
  final String name;
  final String email;
  final String role;
  final Map<String, String>? permissions;
  final String? memberId;

  User({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
    this.permissions,
    this.memberId,
  });
}
