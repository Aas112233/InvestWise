# InvestWise - Demo Test Data for Manual Entry

> **Global Configuration:**
> - **Currency:** BDT or USD ($)
> - **Share Value:** **1 Share = 1,000 (BDT/USD)**
> - **Rule:** Deposit amount must exactly match the number of shares (e.g., 7 Shares = 7,000).

Use this data to populate the application and verify that calculations (totals, ROI, balances) are working correctly.

## 1. Members (5)
*Enter these in the **Members** management section.*

| Member ID | Name | Role | Total Shares (Expected) | Total Contribution (Expected) | Phone |
|-----------|------|------|-------------------------|-------------------------------|-------|
| #135122   | Harvey Specter | Associate Member | 15 | 15,000 | +123456783 |
| #304751   | John Doe | Associate Member | 7 | 7,000 | +123456789 |
| #377574   | Jane Smith | Associate Member | 6 | 6,000 | +123456780 |
| #224809   | Mike Ross | Associate Member | 4 | 4,000 | +123456781 |
| #137126   | Rachel Zane | Associate Member | 4 | 4,000 | +123456782 |

---

## 2. Initial Funds (2)
*Create these in **Funds Management** before adding deposits/projects.*

| Fund Name | Initial Balance | Description |
|-----------|-----------------|-------------|
| **General Reserves** | 50,000 | Primary fund for operations and investments |
| **Emergency Fund** | 20,000 | Reserved for unexpected expenses |

---

## 3. Projects (2)
*Create these in **Project Management**. Note: Each project will auto-generate a fund.*

### Project 1: Solar Farm Expansion
- **Title:** Solar Farm Expansion
- **Budget:** 25,000
- **Initial Investment:** 15,000 (Deduct from General Reserves)
- **Stakeholder Equity (1 Share = 1,000):**
    | Member | Shares Invested | Value | Ownership % |
    |--------|-----------------|-------|-------------|
    | Harvey Specter | 10 | 10,000 | 66.7% |
    | John Doe | 5 | 5,000 | 33.3% |
- **Description:** Expanding solar capacity. Fund: `Solar Fund (F-Solar)`

### Project 2: Real Estate Development
- **Title:** Real Estate Development
- **Budget:** 40,000
- **Initial Investment:** 20,000 (Deduct from General Reserves)
- **Stakeholder Equity (1 Share = 1,000):**
    | Member | Shares Invested | Value | Ownership % |
    |--------|-----------------|-------|-------------|
    | Jane Smith | 6 | 6,000 | 30.0% |
    | Harvey Specter | 5 | 5,000 | 25.0% |
    | Mike Ross | 4 | 4,000 | 20.0% |
    | Rachel Zane | 4 | 4,000 | 20.0% |
    | John Doe | 1 | 1,000 | 5.0% |
- **Description:** Construction of residential building. Fund: `Realty Fund (F-Realty)`

---

## 4. Member Deposits (10)
*Enter these in the **Deposits** section. Total deposits for each member must match their total shares.*

| No. | Member Name | Fund Name | Amount | Equivalent | Description |
|-----|-------------|-----------|--------|------------|-------------|
| 1   | **Harvey Specter**| General Reserves | 10,000 | **10 Shares**| Primary Buy-in |
| 2   | **John Doe** | General Reserves | 7,000 | **7 Shares**| Full Buy-in |
| 3   | **Jane Smith** | General Reserves | 6,000 | **6 Shares**| Full Buy-in |
| 4   | **Mike Ross** | General Reserves | 4,000 | **4 Shares**| Full Buy-in |
| 5   | **Rachel Zane** | General Reserves | 4,000 | **4 Shares**| Full Buy-in |
| 6   | **Harvey Specter**| General Reserves | 5,000 | **5 Shares**| Final Buy-in |


*Note: For the purpose of strict share matching ($7,000 = 7 Shares), ignore entries 7-10 if your system only counts "Investment" deposits towards shares.*

---

## 5. Expenses (10)
*Enter these in the **Expenses** section.*

| No. | Description | Category | Fund Name | Project | Amount |
|-----|-------------|----------|-----------|---------|--------|
| 1   | Office Rent | Utilities | Emergency Fund | None | 1,500 |
| 2   | Utility Bill | Utilities | General Reserves | None | 500 |
| 3   | Solar Panels | Equipment | Solar Fund | Solar Farm | 8,000 |
| 4   | Land Survey | Professional | Realty Fund | Real Estate | 2,000 |
| 5   | Software | IT | General Reserves | None | 300 |
| 6   | Site Security | Services | Solar Fund | Solar Farm | 1,000 |
| 7   | Architect Fees| Professional | Realty Fund | Real Estate | 5,000 |
| 8   | Marketing | Advertising | General Reserves | None | 1,200 |
| 9   | Labor Cost | Services | Solar Fund | Solar Farm | 3,000 |
| 10  | Stationery | Office | General Reserves | None | 100 |

---

## 6. Project Operations Updates (10)
*Enter these in the **Project Updates** section.*

| No. | Project | Type | Amount | Description |
|-----|---------|------|--------|-------------|
| 1   | Solar Farm | **+ Earning** | 2,000 | Energy Sales Revenue |
| 2   | Solar Farm | *- Expense* | 500 | Battery Maintenance |
| 3   | Real Estate| **+ Earning** | 5,000 | Pre-sale Deposit |
| 4   | Real Estate| *- Expense* | 1,000 | Legal Documentation |
| 5   | Solar Farm | **+ Earning** | 1,500 | Govt Subsidy |
| 6   | Solar Farm | *- Expense* | 200 | Site Cleaning |
| 7   | Real Estate| **+ Earning** | 8,000 | Pre-sale Deposit |
| 8   | Real Estate| *- Expense* | 1,500 | Foundation Materials |
| 9   | Solar Farm | **+ Earning** | 3,000 | Bulk Energy Sale |
| 10  | Real Estate| *- Expense* | 500 | Structural Inspection |

---

## 7. Expected Totals (For Verification)

### Member Contribution Verification:
| Member | Total Deposits | Expected Total Shares |
|--------|----------------|-----------------------|
| **Harvey Specter** | 15,000 | **15 Shares** |
| **John Doe** | 7,000 | **7 Shares** |
| **Jane Smith** | 6,000 | **6 Shares** |
| **Mike Ross** | 4,000 | **4 Shares** |
| **Rachel Zane** | 4,000 | **4 Shares** |
| **TOTAL** | **36,000** | **36 Shares** |

### Project Financial Health:
- **Project 1 (Solar Farm):** Net Balance: -6,200
- **Project 2 (Real Estate):** Net Balance: +3,000

### Global Fund Balances (Net Change):
- **General Reserves:** -1,100  
  *(Calculation: 36k Deposits - 2.1k Overhead - 35k Project Investments)*
- **Emergency Fund:** -1,500  
  *(Calculation: 0k Deposits - 1.5k Overhead)*
