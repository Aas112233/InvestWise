# Member & Access Control Specification

## Overview
Handles partner onboarding and links physical members to system users for RBAC (Role-Based Access Control).

## Required Endpoints

### 1. `POST /api/v1/members`
Onboards a new partner.
- **Logic**: 
    - Create record in `members` table.
    - If `hasUserAccess` is true:
        - Trigger `POST /api/v1/users` internally.
        - Encrypt the provided password using Argon2 or BCrypt.
        - Map `memberId` to the new user record.
        - Assign default permissions based on the selected `role`.

### 2. `GET /api/v1/members/matrix`
Returns the regularity matrix seen in the Analysis screen.
- **Logic**: A cross-join between `members` and a generated `months` series for the current year. Check `deposits` table for matches.

### 3. `PATCH /api/v1/users/:id/permissions`
Updates the module-level access matrix.
- **Schema**: Stores a JSON object of `AppScreen: AccessLevel`.

## Logic Requirements
- **Member ID Generation**: Must be a unique, non-sequential 6-digit identifier.
- **Deletion**: Soft-delete members to maintain financial history integrity.
- **Authentication**: JWT-based auth. Ensure `permissions` are included in the token payload to minimize DB hits on the frontend.
