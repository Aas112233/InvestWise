interface PaginationDefaults {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
  sortBy: string;
  sortOrder: number;
  sortOptions: Record<string, number>;
}

interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  pages: number;
  hasNext: boolean;
  hasPrev: boolean;
  from: number;
  to: number;
}

interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

/**
 * Formats a paginated response for the API
 * @param data - The slice of data for the current page
 * @param page - Current page number
 * @param limit - Items per page
 * @param totalCount - Total number of items in the collection
 * @returns Standardised pagination object
 */
export const formatPaginatedResponse = <T>(
  data: T[],
  page: number,
  limit: number,
  totalCount: number
): PaginatedResponse<T> => {
  const totalPages = Math.ceil(totalCount / limit);
  const currentPage = Number(page);
  const itemsLimit = Number(limit);

  return {
    data,
    meta: {
      total: totalCount,
      page: currentPage,
      limit: itemsLimit,
      pages: totalPages,
      hasNext: currentPage < totalPages,
      hasPrev: currentPage > 1,
      from: totalCount === 0 ? 0 : (currentPage - 1) * itemsLimit + 1,
      to: Math.min(currentPage * itemsLimit, totalCount)
    }
  };
};

/**
 * Parses pagination and sorting parameters from request query
 *
 * NOTE: The returned `sortOptions` uses the Mongoose-compatible format
 * `{ [column]: 1 | -1 }`. When using with Drizzle ORM, transform it to
 * `asc()`/`desc()` helpers, for example:
 * @example
 * const { sortBy, sortOrder } = getPaginationParams(req.query);
 * const orderByCol = sortOrder === 1
 *   ? asc(table[sortBy])
 *   : desc(table[sortBy]);
 *
 * @param query - req.query
 * @param defaults - default values
 * @returns { page, limit, skip, sortBy, sortOrder, sortOptions }
 */
export const getPaginationParams = (
  query: Record<string, unknown>,
  defaults: PaginationDefaults = {}
): PaginationParams => {
  const page = Math.max(1, Number(query.page) || defaults.page || 1);
  const limit = Math.max(
    1,
    Math.min(100, Number(query.limit) || defaults.limit || 10)
  );
  const skip = (page - 1) * limit;

  const sortBy = String(query.sortBy || defaults.sortBy || 'createdAt');
  const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
  const sortOptions: Record<string, number> = { [sortBy]: sortOrder };

  return { page, limit, skip, sortBy, sortOrder, sortOptions };
};
