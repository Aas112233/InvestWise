import type { Request, Response, NextFunction } from 'express';

export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    pages: number;
    hasNext: boolean;
    hasPrev: boolean;
    from: number;
    to: number;
  };
}

export function getPaginationParams(query: Record<string, any>, defaults?: Partial<PaginationParams>): PaginationParams {
  const page = Math.max(1, parseInt(query.page) || defaults?.page || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || defaults?.limit || 20));
  const skip = (page - 1) * limit;
  const sortBy = query.sortBy || defaults?.sortBy || 'createdAt';
  const sortOrder = query.sortOrder === 'asc' ? 'asc' : defaults?.sortOrder || 'desc';

  return { page, limit, skip, sortBy, sortOrder };
}

export function formatPaginatedResponse<T>(data: T[], page: number, limit: number, totalCount: number): PaginatedResponse<T> {
  const pages = Math.ceil(totalCount / limit) || 1;
  const from = data.length > 0 ? (page - 1) * limit + 1 : 0;
  const to = (page - 1) * limit + data.length;

  return {
    data,
    meta: {
      total: totalCount,
      page,
      limit,
      pages,
      hasNext: page < pages,
      hasPrev: page > 1,
      from,
      to,
    },
  };
}

// User attached to request by auth middleware
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        name: string;
        email: string;
        role: string;
        status: string;
        permissions: Record<string, string>;
        lastLogin: string | null;
        avatar: string | null;
        memberId: string | null;
        createdAt: string;
        updatedAt: string;
      };
      correlationId?: string;
      apiVersion?: string;
    }
  }
}

export type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;
