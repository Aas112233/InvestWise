# Project Management Specification

## Overview
Tracks the lifecycle of group ventures from initiation to liquidation/completion.

## Required Endpoints

### 1. `POST /api/v1/projects` (Initiation)
- **Logic**: 
    1. Create project record.
    2. Deduct `initialInvestment` from `General_Pool`.
    3. Credit `initialInvestment` to a new or existing `Project_Fund_Bucket`.
    4. Register `involvedMembers` in the `project_participation` junction table.

### 2. `POST /api/v1/projects/:id/updates`
Record an Earning or Expense for a project.
- **Logic**: 
    - If `Earning`: Increase `project.currentFundBalance`.
    - If `Expense`: Decrease `project.currentFundBalance`.
    - Trigger an audit trail entry.

### 3. `GET /api/v1/projects/:id/performance`
Calculates ROI and per-member profit share.
- **Formula**: `(currentFundBalance - initialInvestment) * (member_shares / total_project_shares)`.

## Logic Requirements
- **Status Machine**: Transitions: `In Progress` -> `Review` -> `Completed`. 
- **Liquidation**: When a project is marked `Completed`, the `currentFundBalance` should be redistributed to the `General_Pool` or members, depending on the board's decision.
