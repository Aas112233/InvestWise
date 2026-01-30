class Member {
  final String id;
  final String memberId;
  final String name;
  final String email;
  final String phone;
  final String role;
  final int shares;
  final double totalContributed;
  final String status;
  final String? avatar;

  Member({
    required this.id,
    required this.memberId,
    required this.name,
    required this.email,
    required this.phone,
    required this.role,
    required this.shares,
    required this.totalContributed,
    required this.status,
    this.avatar,
  });
}
