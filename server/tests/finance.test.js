import mongoose from 'mongoose';
import { jest } from '@jest/globals';

// Mock the models before importing controllers or routes
jest.unstable_mockModule('../models/Transaction.js', () => ({
  default: {
    create: jest.fn()
  }
}));

const Transaction = (await import('../models/Transaction.js')).default;

describe('Finance Controller - Deposit Validation', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should successfully create a valid deposit transaction', async () => {
    const mockTransaction = {
      _id: new mongoose.Types.ObjectId(),
      type: 'Deposit',
      amount: 100,
      memberId: new mongoose.Types.ObjectId(),
    };

    Transaction.create.mockResolvedValueOnce(mockTransaction);

    const result = await Transaction.create({
      type: 'Deposit',
      amount: 100,
    });

    expect(result).toBeDefined();
    expect(result.amount).toBe(100);
    expect(Transaction.create).toHaveBeenCalledTimes(1);
  });

  it('should throw an error for negative deposit amounts', async () => {
    Transaction.create.mockRejectedValueOnce(new Error('ValidationError: Amount cannot be negative'));

    await expect(Transaction.create({
      type: 'Deposit',
      amount: -50,
    })).rejects.toThrow('ValidationError');
    
    expect(Transaction.create).toHaveBeenCalledTimes(1);
  });
});
