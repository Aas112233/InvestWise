# Deposits & Vesting Pipeline Specification

## Overview
Manages the primary capital inflow. This module requires strict transactional integrity.

## Required Endpoints

### 1. `GET /api/v1/deposits`
List all confirmed deposits. Supports filtering by member, month, and status.

### 2. `POST /api/v1/deposits/request`
Created by members or managers to signal intent to deposit.
- **Logic**: Status defaults to `Pending`. Does not affect `funds` balance until approved.

### 3. `POST /api/v1/deposits/:id/approve`
- **Logic**: 
    1. Update `deposit.status` to `Completed`.
    2. Atomic Transaction:
        - Increment `member.totalContributed`.
        - Increment `fund.balance` where fund_id = 'Cashier_General_Pool'.
        - Create record in `global_transactions` table.

## Logic Requirements
- **Auto-Calculation**: The system must verify that `amount == shares * SHARE_VALUE` unless an override is authorized by an Administrator.
- **Concurrency**: Prevent double-approving a request by using database row-level locking.
- **Monthly Constraints**: Logic should flag or prevent multiple deposits from the same member for the same `depositMonth` unless specified as "Extra Shares".
