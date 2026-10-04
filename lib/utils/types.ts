import { ValidationError } from './errors';

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

export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Coerce an optional text field from a request body, returning null when the
 * caller sent nothing or an empty string, and rejecting an over-long value
 * with a clean 400 instead of letting it reach Postgres and surface as a raw
 * 500. Shared by the member create and update routes so a field accepted with
 * one length limit on create cannot fail with a different one on edit.
 */
export function optionalStringField(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).trim();
  if (!s) return null;
  if (s.length > max) throw new ValidationError(`${field} must be at most ${max} characters`);
  return s;
}