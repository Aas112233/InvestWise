# Dashboard API & Logic Specification

## Overview
The Dashboard serves as the strategic nerve center of InvestWise. It requires high-performance data aggregation from multiple tables (Deposits, Projects, Expenses).

## Required Endpoints

### 1. `GET /api/v1/dashboard/summary`
Calculates high-level metrics for StatCards.
- **Logic**: 
    - `totalDeposits`: SUM(amount) from `deposits` where status = 'Completed'.
    - `investedCapital`: SUM(initialInvestment) from `projects`.
    - `totalMembers`: COUNT(*) from `members`.
    - `totalShares`: SUM(shares) from `members`.
    - `yieldIndex`: Complex calculation based on (SUM(project_earnings) - SUM(project_expenses)) / total_investment.

### 2. `GET /api/v1/dashboard/charts/capital-trends`
Provides timeseries data for the Area Chart.
- **Data Source**: A union of `deposits` (Inflow) and `expenses` + `project_investments` (Outflow).
- **Grouping**: Group by month/year for the last 6-12 months.

### 3. `GET /api/v1/dashboard/charts/diversification`
Portfolio breakdown for the Pie Chart.
- **Logic**: Group `projects` by `category` and calculate SUM(initialInvestment).

## Logic Requirements
- **Real-time Updates**: Use WebSockets or long-polling for yield index changes as projects report earnings.
- **Permission Scope**: Administrators see global data; Investors see a filtered version limited to projects they are involved in.
