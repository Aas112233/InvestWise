# Funds & Liquidity Specification

## Overview
The "Vault" logic of the application. Tracks high-level buckets of capital.

## Required Endpoints

### 1. `GET /api/v1/funds`
Returns all fund buckets (Primary, Reserve, Project-Specific).

### 2. `POST /api/v1/funds/transfer`
Moves money internally between buckets.
- **Logic**: 
    - Must verify `source_fund.balance >= amount`.
    - Transactional: Deduct from Source, Add to Target.
    - Log entry in `fund_transfers` table with `authorized_by_id`.

## Logic Requirements
- **Audit Logging**: Every single change to a fund balance must have a corresponding entry in an immutable `audit_log` table.
- **Snapshotting**: Daily balance snapshots should be taken at 00:00 UTC for historical reporting and trend analysis.
- **Alerts**: Trigger system notification if `Strategic_Reserve` falls below a defined percentage of total liabilities.
