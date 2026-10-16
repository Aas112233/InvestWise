# InvestWise — API Response Message Catalog

Generated from `app/api/**` + `server/src/**` (all route handlers and service throws).  
Source: `scripts/extract-api-messages.cjs`.

## 1. Response envelope + error taxonomy

Every response is `{ success, data?, message?, code? }`. Errors carry an HTTP status  
from the thrown error class (`lib/utils/errors.ts` for app routes,  
`server/src/shared/errors.ts` for finance-module routes — same taxonomy):

| Class                   | Status | Code                | Default message                 |
| ----------------------- | ------ | ------------------- | ------------------------------- |
| ValidationError         | 400    | VALIDATION_ERROR    | (per-call)                      |
| AuthError               | 401    | UNAUTHORIZED        | (per-call)                      |
| ForbiddenError          | 403    | FORBIDDEN           | Insufficient permissions        |
| NotFoundError           | 404    | NOT_FOUND           | `<Resource> not found`          |
| ConflictError           | 409    | CONFLICT            | (per-call)                      |
| LockedError             | 423    | LOCKED              | (per-call)                      |
| ServiceUnavailableError | 503    | SERVICE_UNAVAILABLE | Service temporarily unavailable |
| AppError                | 500    | INTERNAL_ERROR      | (per-call)                      |

Field-level validation errors follow AGENTS.md §11:  
`[Field '<field>', Code: <code>] <message>` — e.g.  
`[Field 'amount', Code: too_small] Deposit amount must be a positive number`.

**Postgres SQLSTATE → response mapping** (`normalizeError`, server/src/shared/errors.ts):

| SQLSTATE   | Status | Code                 | Message                                                       |
| ---------- | ------ | -------------------- | ------------------------------------------------------------- |
| 22003      | 400    | NUMERIC_OVERFLOW     | A numeric value is out of range.                              |
| 23502      | 400    | NOT_NULL_VIOLATION   | A required field is missing (not-null violation).             |
| 23503      | 409    | FK_VIOLATION         | This action would violate a database relationship constraint. |
| 23505      | 409    | DUPLICATE_KEY        | A record with that value already exists (duplicate key).      |
| 23514      | 400    | CHECK_VIOLATION      | The value provided does not meet the required constraints.    |
| 40001      | 503    | TRANSACTION_CONFLICT | Database transaction conflict. Please retry.                  |
| 57014      | 504    | QUERY_TIMEOUT        | Database query timed out. Please try again.                   |
| 40P01      | 503    | DEADLOCK             | Deadlock detected. Please retry.                              |
| 08006      | 503    | DB_CONNECTION_ERROR  | Database connection lost. Please try again.                   |
| (unmapped) | 500    | INTERNAL_ERROR       | An unexpected error occurred                                  |

---

## 2.1 ValidationError — 88 unique messages (HTTP 400)

*Bad request — input validation*

- `A deletion reason is required per financial compliance rules`
- `A dividend run with this reference number already exists`
- `A fund appears more than once in the allocations`
- `A non-empty array of attendees is required`
- `A non-empty array of data is required for generic export`
- `A reason is required and is recorded in the audit log`
- `A reason is required to waive a penalty`
- `Amount must have at most 2 decimal places`
- `At least one deposit request row is required`
- `Current password and new password are required`
- `Deposit amount must be a positive number`
- `Deposit is missing fund or member linkage`
- `Deposit transaction is missing its date`
- `Duplicate member found in project shareholder list`
- `Each attendee must have a valid memberId`
- `Email is required`
- `Expense amount must be a positive number`
- `Fiscal period not found for this tenant`
- `Fiscal year start and end months must differ`
- `Fund is not active`
- `Fund percentages must not exceed 100% in total`
- `Member is not active`
- `Name must be at least 2 characters`
- `No active shareholders found to receive the member portion of this distribution`
- `Only completed deposits can be reverted to request`
- `Only pending deposits can be approved`
- `Only pending deposits can be rejected`
- `Paired transfer leg is missing its date`
- `Password is required`
- `Penalty is already waived`
- `Reference number may not contain "%" or "_"`
- `Rejection reason is required`
- `Share numbers are locked after member creation and cannot be changed by deposits`
- `The selected fiscal period does not contain the dividend transaction date`
- `This project has no linked fund, so its earnings and expenses cannot be posted. Link an existing fund or create its dedicated fund first.`
- `This project has no linked fund, so its returns cannot be distributed. Link an existing fund or create its dedicated fund first.`
- `This transaction must be restored through the deposit approval path, not the recovery desk`
- `Too many attendees in one request (maximum 2000)`
- `Transaction is already deleted`
- `Transaction is missing its date`
- `Transaction is not a deposit`
- `Transaction is not deleted`
- `Transaction with this reference number already exists`
- `[Field 'amount', Code: invalid_string] Amount must be a positive number with at most 2 decimal places`
- `[Field 'amount', Code: invalid_string] Amount must have at most 2 decimal places`
- `[Field 'amount', Code: invalid_string] Deposit amount must be a positive number`
- `[Field 'amount', Code: too_small] Deposit amount must be a positive number`
- `[Field 'approvedBy', Code: cross_tenant] Approver does not belong to this tenant`
- `[Field 'collectedDate', Code: invalid_date] Collected date is invalid`
- `[Field 'createdBy', Code: SELF_APPROVAL] You cannot approve your own deposit request.`
- `[Field 'depositMethod', Code: invalid_payment_method] Unknown payment method — configure it in Settings → Governance first`
- `[Field 'depositMonth', Code: invalid_string] Deposit month filter must be in YYYY-MM format`
- `[Field 'depositMonth', Code: invalid_string] Deposit month must be in YYYY-MM format`
- `[Field 'description', Code: required] Description is required`
- `[Field 'expenseName', Code: required] Expense name is required`
- `[Field 'expenseName', Code: too_long] Expense name must be at most 255 characters`
- `[Field 'financial', Code: invalid_type] Financial configuration must be an object`
- `[Field 'fundId', Code: NOT_FOUND] Fund not found in this tenant`
- `[Field 'fundId', Code: REQUIRED] A target fund is required for this report`
- `[Field 'fundId', Code: cross_tenant] Fund does not belong to this tenant`
- `[Field 'fundId', Code: required] Fund is required — every transaction must post against a fund`
- `[Field 'isShareValueLocked', Code: SHARE_VALUE_LOCKED] The share value lock derives from ledger history — transactions already exist for this tenant, so it cannot be unlocked`
- `[Field 'memberId', Code: NOT_FOUND] Member not found in this tenant`
- `[Field 'memberId', Code: REQUIRED] A target member is required for this report`
- `[Field 'memberId', Code: cross_tenant] Member does not belong to this tenant`
- `[Field 'memberId', Code: required] Expense by member is required`
- `[Field 'projectId', Code: NOT_FOUND] Project not found in this tenant`
- `[Field 'projectId', Code: REQUIRED] A target project is required for this report`
- `[Field 'projectId', Code: cross_tenant] Project does not belong to this tenant`
- `[Field 'reason', Code: required] A revert reason is required per financial compliance rules`
- `[Field 'referenceNumber', Code: DUPLICATE] Transaction with this reference number already exists`
- `[Field 'submittedDate', Code: invalid_date] Submission date is invalid`
- `[Field 'type', Code: required] Transaction type is required`
- `action must be either 'suspend' or 'reinstate'`
- `category is required`
- `date cannot be in the future`
- `date must be a valid ISO date/datetime`
- `fundId is required`
- `grossEarnings and distributableFundId are required`
- `grossEarnings must be a number or numeric string`
- `handledByMemberId does not match a member of this tenant`
- `handledByMemberId must be a member associated with this project`
- `linkedProjectId must be a string`
- `memberId and fundId are required`
- `memberId, tier, and reason are required`
- `referenceNumber must be a business reference (e.g. PRJ-EXP-… / PRJ-REV-…); omit it to have one generated`
- `title and targetAmount are required`
- `title, meetingDate, and meetingType are required`

## 2.2 ConflictError — 13 unique messages (HTTP 409)

*State conflict / duplicate*

- `A member with this email already exists`
- `A tenant with this slug already exists`
- `A user with this email already exists`
- `An equity transfer with this reference has already been recorded`
- `Could not allocate a member code — please retry.`
- `Fiscal period is already closed`
- `Only a closed fiscal period can be reopened`
- `Resolve pending transactions in this period before closing it`
- `This bulk deposit request key was already used for different data. [IDEMPOTENCY_KEY_REUSED]`
- `This fiscal year overlaps an existing fiscal period`
- `Transaction already approved`
- `[Field 'role', Code: last_admin] This is the last active Admin in your organization. Promote another user to Admin first.`
- `[Field 'role', Code: self_demotion] You cannot demote or deactivate your own account`

## 2.3 AppError — 51 unique messages (HTTP varies)

*Explicit app-level error (status per call)*

- `A recipient can appear only once per transfer`
- `A revert reason is required per financial compliance rules`
- `Account is inactive`
- `Account is suspended`
- `Authentication required`
- `Cannot manually change a fund to PROJECT type`
- `Cannot transfer between funds with different currencies`
- `Content-Type must be application/json`
- `Deleted transactions cannot be reverted`
- `Deposit is missing fund or member linkage`
- `Distributable fund not found`
- `Failed to create fund`
- `Failed to create tenant`
- `Failed to create user`
- `Failed to record deposit`
- `Failed to record earning`
- `Failed to record expense`
- `Failed to record fund transfer`
- `Linked project must belong to your organization`
- `No active members with shares found. Dividend cannot be distributed.`
- `Only completed deposits can be reverted to request`
- `Only deposits can be approved`
- `Only deposits can be reverted`
- `PROJECT funds are automatically created when a Project is initialized.`
- `Payout fund disappeared mid-run`
- `Platform operators must use /api/admin endpoints`
- `Project-specific funds cannot be used for general expenses.`
- `Project-specific funds cannot be used for general expenses. Please select a project first.`
- `Rate must be an integer micro amount`
- `Request body is too large`
- `Request body must be a JSON object`
- `Request body must be valid JSON`
- `Self-transfer of equity is not permitted`
- `Source and destination funds cannot be the same`
- `Source and target funds must be different`
- `Statutory reserve percent must be between 0 and 100`
- `Subscription is inactive. Please contact support.`
- `Tenant context required`
- `Tenant is in maintenance mode`
- `Tenant is suspended`
- `The selected reserve fund must be a RESERVE type fund`
- `Token rotation is not permitted by the database constraint (blacklisted_tokens_reason_check). Apply migration 0011_blacklist_rotation_reason.sql.`
- `Transaction is already deleted`
- `Transaction is not a deposit`
- `Transaction is not an expense`
- `Transactions for this project must be routed through its dedicated project fund.`
- `Transferring contribution without shares changes the recipient\`
- `Transferring shares without their contribution balance gives the recipient a claim on future surplus they did not fund. Acknowledge this as a gift to continue.`
- `[Field 'depositMethod', Code: invalid_payment_method] Unknown payment method — configure it in Settings → Governance first`
- `[Field 'depositMonth', Code: invalid_string] Deposit month must be in YYYY-MM format`
- `sourceFundId (or fromFundId) and targetFundId (or toFundId) are required`


## 2.4 NotFoundError — 23 unique messages (HTTP 404)

*Resource not found*

- `Deposit transaction not found`
- `Fiscal period not found`
- `Fund not found`
- `Goal not found`
- `Linked fund not found`
- `Meeting not found`
- `Member not found`
- `Member profile for this login not found`
- `New project not found`
- `One or more attendees not found`
- `Penalty not found`
- `Project not found`
- `Recipient fund not found`
- `Session not found`
- `Source Fund not found`
- `Source fund not found`
- `Source member not found`
- `Target Fund not found`
- `Target fund not found`
- `Target member not found`
- `Tenant not found`
- `Transaction not found`
- `User not found`

## 2.5 ForbiddenError — 36 unique messages (HTTP 403)

*Permission denied*

- `Admin access required`
- `Admin access required to recalculate member financials`
- `Admin or Manager access required`
- `Admin privilege required to delete meeting`
- `Admin privilege required to restore transactions`
- `Admin privilege required to soft-delete transactions`
- `Admin privilege required to view deleted transactions`
- `Administrative privilege required to waive penalties`
- `Insufficient permissions to complete a meeting`
- `Insufficient permissions to issue penalties`
- `Insufficient permissions to record meeting attendance`
- `Insufficient permissions to record transactions`
- `Insufficient permissions to schedule meetings`
- `Insufficient permissions to update meeting`
- `Linked fund does not belong to this tenant`
- `Platform accounts cannot be managed here`
- `Read permission required for: DEPOSITS`
- `Read permission required for: DIVIDENDS`
- `Read permission required for: EXPENSES`
- `Read permission required for: FISCAL`
- `SuperAdmin accounts cannot be created here`
- `Tenant context required`
- `This email address is reserved for platform use`
- `Write permission required for: DEPOSITS`
- `Write permission required for: DIVIDENDS`
- `Write permission required for: EXPENSES`
- `Write permission required for: FISCAL`
- `Write permission required for: MEMBERS`
- `Write permission required for: REQUEST_DEPOSIT`
- `Write permission required for: SETTINGS`
- `You can only cancel or delete your own deposit request`
- `You can only delete your own goals`
- `You can only edit your own deposit request`
- `You can only update your own goals`
- `You cannot reassign a deposit request to another member`
- `linkedProjectId must be a string`

## 2.6 LockedError — 7 unique messages (HTTP 423)

*Locked — immutable state*

- `Account is inactive. Please contact an administrator.`
- `Account is suspended. Please contact an administrator.`
- `Account temporarily locked due to too many failed attempts. Please try again later.`
- `Dividend payouts cannot be allocated to a closed fiscal period`
- `Fiscal year months cannot be changed after a fiscal period has been created`
- `Share numbers are locked once transactions exist`
- `Share value is locked and cannot be changed`

## 2.7 AuthError — 13 unique messages (HTTP 401)

*Authentication failure / session issues*

- `Authenticated session is not available [TOKEN_REVOKED]`
- `Current password is incorrect [INVALID_PASSWORD]`
- `Invalid email or password`
- `Invalid token [INVALID_TOKEN]`
- `Invalid token type [INVALID_TOKEN]`
- `Refresh token is not bound to an active session [TOKEN_REVOKED]`
- `Refresh token or session has been revoked [TOKEN_REVOKED]`
- `Server authentication is not configured [SERVER_MISCONFIGURED]`
- `Session expired due to inactivity. Please sign in again. [SESSION_IDLE_EXPIRED]`
- `Session has expired. Please sign in again. [SESSION_EXPIRED]`
- `Token has been revoked or already rotated [TOKEN_REVOKED]`
- `Token has expired [TOKEN_EXPIRED]`
- `User not found [USER_NOT_FOUND]`

---

## 3. Success response messages — 73 unique

(2xx envelopes; DB-mapped messages excluded — see section 1.)

- At least one field must be provided
- At least one of name, role, status or permissions must be provided
- At least one setting must be provided
- Backup listing is not available in this build. Inspect the managed database snapshot console for available restore points.
- Deposit approved successfully
- Deposit recorded successfully
- Deposit rejected successfully
- Deposit request submitted successfully. Awaiting approval.
- Deposit reverted to request successfully
- Dividend calculation completed (simulation)
- Dividend distribution completed successfully
- Equity transfer completed successfully
- Exited impersonation
- Expense recorded successfully
- Fund transfer completed successfully
- Goal created successfully
- Goal deleted successfully
- Goal updated successfully
- If an account matches this email, the recovery request has been recorded for the administrators.
- Impersonation session revoked
- Logged out from all devices
- Logged out successfully
- Meeting attendance recorded successfully
- Meeting deleted successfully
- Meeting scheduled successfully
- Meeting updated successfully
- Member removed from the directory. Attendance and penalty records were retained for audit.
- Member updated successfully.
- Module entitlements updated
- Notice broadcasted successfully
- Notice retracted
- Notice updated
- Organization created
- Password changed successfully
- Password reset. The user must sign in with the new credential.
- Penalty issued successfully
- Penalty waived successfully
- Plan created
- Plan deleted
- Plan updated
- Platform settings saved
- Project cancelled successfully
- Project created successfully with shareholder allocations
- Project update recorded successfully
- Project updated successfully
- Session revoked successfully
- Subscription updated successfully
- Tenant created successfully
- Tenant deleted successfully
- Tenant force deleted
- Tenant onboarded successfully
- Tenant updated successfully
- Transaction deleted and archived to deleted records
- Transaction recorded successfully
- Transaction restored and its balance effect re-applied
- Transfer shares, an amount, or both
- User created successfully
- User deleted
- User updated
- pong
- `${failed.length} tenant(s) failed to sweep`
- `${name} added successfully.`
- `${prepared.length} deposit request(s) submitted successfully. Awaiting approval.`
- `Recalculated ${liveMembers.length} members — ${monthsCorrected} deposit-month ${
        monthsCorrected === 1 ? 'value' : 'values'
      } corrected, ${equityDrift.length} equity ${
        equityDrift.length === 1 ? 'row needs review' : 'rows need review'
      }.`

---

## 4. Inline error envelopes (raw `{ success: false, message }` responses) — 103 unique

These bypass the error classes and write the envelope directly (mostly  
auth guards, middleware, 501 stubs and catch-block fallbacks).

- A valid email address is required
- Authentication required
- Backup failed
- Backup restore is not implemented in this build. Use the managed database snapshot tooling to restore, then verify row counts before resuming writes.
- Bot verification is required.
- Bulk deposits are temporarily unavailable. Please try again.
- Cannot delete tenant with existing users. Transfer or delete users first.
- Cannot delete the default tenant
- Cannot suspend the default tenant
- Check the form and try again.
- Could not create your organization
- Diagnostics probe failed
- Email and password are required
- Failed to broadcast notice
- Failed to create plan
- Failed to create tenant
- Failed to delete plan
- Failed to delete tenant
- Failed to delete user
- Failed to get audit logs
- Failed to get audit metadata
- Failed to get login history
- Failed to get notifications
- Failed to get profile
- Failed to get sessions
- Failed to get settings
- Failed to get share value status
- Failed to get tenants
- Failed to get users
- Failed to list backups
- Failed to list users
- Failed to load billing history
- Failed to load billing view
- Failed to load module entitlements
- Failed to load plans
- Failed to load platform settings
- Failed to load tenant details
- Failed to reset password
- Failed to retract notice
- Failed to retrieve audit logs
- Failed to retrieve notice
- Failed to retrieve notices
- Failed to retrieve platform action log
- Failed to revoke session
- Failed to save platform settings
- Failed to update module entitlements
- Failed to update notice
- Failed to update plan
- Failed to update settings
- Failed to update tenant
- Failed to update user
- Fiscal year must be an integer from 1900 to 9998
- Governance sweep failed
- Impersonation failed
- Insufficient permissions to view deposit history
- Insufficient permissions to view governance data
- Invalid or missing cron secret
- Invalid status. Must be active or suspended
- Login failed
- Logout failed
- Logout from all devices failed
- No active impersonation session to exit
- Notice not found
- Only an Admin can change a member status
- Only an Admin can recalculate performance scores
- Password change failed
- Passwords do not match
- Plan not found
- Public registration is currently disabled.
- Refresh token is required
- Restore failed
- Revoke failed
- Sign-up is temporarily unavailable. Please try again later.
- Slug and name are required
- Subscription expiry evaluation failed
- Subscription update failed
- Tenant context required
- Tenant not found
- Tenant onboarding failed
- Token refresh failed
- Too many bulk deposit attempts. Please try again later.
- Too many login attempts. Please try again later.
- Too many recovery requests. Please try again later.
- Too many requests right now. Please try again later.
- Too many sign-up attempts. Please try again later.
- Unable to process recovery request at this time.
- Unauthorized
- User not found
- User registration failed
- Validation failed
- We could not create the organization with those details.
- backupKey is required
- name, adminEmail and adminPassword are required
- tenantId is required
- `Cannot delete tenant: ${error.detail || error.message}`
- `Cannot delete user: ${db.message ?? 'a record still references this account'}`
- `Cannot delete: ${inUse?.count} tenant(s) are still on this plan. Deactivate it instead.`
- `[Field '${field}', Code: ${issue?.code || 'invalid_type'}] ${issue?.message || 'Invalid input'}`
- `[Field 'password', Code: weak_password] ${strength.message}`
- `[Field 'severity', Code: invalid_enum] Expected one of ${NOTICE_SEVERITIES.join(', ')}`
- `[Field 'slug', Code: duplicate] A plan with slug '${slug}' already exists`
- `[Field 'status', Code: invalid_enum] Must be one of: ${ALLOWED_STATUSES.join(', ')}`
- `[Field 'suspendedAfterMonths', Code: INVALID_THRESHOLD_ORDER] Must be greater than inactiveAfterMonths (${mergedInactive}); received ${mergedSuspended}.`


## 6. Observations

- **§11 field-error format is used consistently** on validation paths:  
  `[Field '<field>', Code: <code>] <message>` (deposits, members, settings,  
  dividends, projects, auth). Plain-message ValidationErrors coexist with  
  them — the format is applied where a specific field is at fault.
- **403 vocabulary is inconsistent** — three phrasings for the same concept:  
  `Read permission required for: <SCREEN>` / `Write permission required for: <SCREEN>` (screen-permission guards), `Admin access required` / `Admin or
  Manager access required` (role guards), and `Insufficient permissions to <verb> <noun>` (meetings/governance). Worth converging on one pattern.
- **NotFoundError is consistent**: `<Resource> not found`, resource named  
  per call site (23 resources). Two casing variants exist for the same  
  resource in transfer flows (`Source fund` vs `Source Fund`) — cosmetic.
- **DB errors are deliberately generic** (9 SQLSTATE mappings in  
  `server/src/shared/errors.ts`); raw driver messages never reach clients.
- **Success messages are human sentences**, uniformly phrased  
  (`<Verb>ed successfully`); a few carry extra guidance  
  (member soft-delete explains retention).
- **Inline error envelopes (103)** bypass the error classes — mostly auth  
  guards, middleware (CSRF/401), 501 stubs (backup restore), and  
  catch-block fallbacks. Migrating them to the class taxonomy would  
  centralize status-code handling.
- **Templated throws (26)** interpolate entity names/amounts into business  
  errors (insufficient balance, equity-transfer guards) — the richest  
  messages in the API.
