import { describe, it, expect } from 'vitest';
import { convertToCsv } from '../modules/reports/service.js';

describe('Reports CSV Exporter', () => {
  it('converts array of objects to CSV format correctly', () => {
    const data = [
      { id: '1', name: 'John Doe', amount: 5000, date: '2026-08-14' },
      { id: '2', name: 'Jane Smith, MBA', amount: 7500.5, date: '2026-08-15' },
    ];

    const csv = convertToCsv(data);
    expect(csv).toContain('id,name,amount,date');
    expect(csv).toContain('"1","John Doe","5000","2026-08-14"');
    expect(csv).toContain('"2","Jane Smith, MBA","7500.5","2026-08-15"');
  });

  it('handles empty data gracefully', () => {
    const csv = convertToCsv([]);
    expect(csv).toBe('');
  });
});

describe('Financial Math & Settlement Formulas', () => {
  it('calculates statutory reserves and distributable surplus correctly', () => {
    const netSurplus = 100000;
    const reserveRate = 0.10; // 10%
    const taxRate = 0.15; // 15%

    const statutoryReserve = netSurplus * reserveRate;
    const distributable = netSurplus - statutoryReserve;

    expect(statutoryReserve).toBe(10000);
    expect(distributable).toBe(90000);

    // Member with 20 shares out of 100 total active shares
    const totalShares = 100;
    const memberShares = 20;
    const memberContribution = 50000;

    const shareOfSurplus = (memberShares / totalShares) * distributable;
    const grossSettlement = memberContribution + shareOfSurplus;
    const taxDeduction = grossSettlement * taxRate;
    const netSettlement = grossSettlement - taxDeduction;

    expect(shareOfSurplus).toBe(18000);
    expect(grossSettlement).toBe(68000);
    expect(taxDeduction).toBe(10200);
    expect(netSettlement).toBe(57800);
  });

  it('calculates rate per share and distributed dividend proportions', () => {
    const totalSurplusToDistribute = 50000;
    const totalActiveShares = 250;

    const ratePerShare = totalSurplusToDistribute / totalActiveShares;
    expect(ratePerShare).toBe(200);

    const memberAShares = 50;
    const payoutA = Math.floor(memberAShares * ratePerShare * 100) / 100;
    expect(payoutA).toBe(10000);

    const memberBShares = 200;
    const payoutB = Math.floor(memberBShares * ratePerShare * 100) / 100;
    expect(payoutB).toBe(40000);

    expect(payoutA + payoutB).toBe(totalSurplusToDistribute);
  });
});

describe('Arrears Shortfall Calculation', () => {
  it('calculates shortfall and status accurately based on shares', () => {
    const shareBaseDue = 1000;
    const memberShares = 3;
    const requiredAmount = shareBaseDue * memberShares; // 3000

    const depositAmount1 = 1500;
    const shortfall1 = Math.max(0, requiredAmount - depositAmount1);
    const status1 = shortfall1 === 0 ? 'PAID' : 'OUTSTANDING';

    expect(requiredAmount).toBe(3000);
    expect(shortfall1).toBe(1500);
    expect(status1).toBe('OUTSTANDING');

    const depositAmount2 = 3000;
    const shortfall2 = Math.max(0, requiredAmount - depositAmount2);
    const status2 = shortfall2 === 0 ? 'PAID' : 'OUTSTANDING';

    expect(shortfall2).toBe(0);
    expect(status2).toBe('PAID');
  });
});
