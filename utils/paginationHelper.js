/**
 * Formats a paginated response for the API
 * @param {Array} data - The slice of data for the current page
 * @param {number} page - Current page number
 * @param {number} limit - Items per page
 * @param {number} totalCount - Total number of items in the collection
 * @returns {Object} Standardised pagination object
 */
export const formatPaginatedResponse = (data, page, limit, totalCount) => {
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
 * @param {Object} query - req.query
 * @param {Object} defaults - default values
 * @returns {Object} { page, limit, skip, sortBy, sortOrder, sortOptions }
 */
export const getPaginationParams = (query, defaults = {}) => {
    const page = Math.max(1, Number(query.page) || defaults.page || 1);
    const limit = Math.max(1, Math.min(100, Number(query.limit) || defaults.limit || 10));
    const skip = (page - 1) * limit;

    const sortBy = query.sortBy || defaults.sortBy || 'createdAt';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    const sortOptions = { [sortBy]: sortOrder };

    return { page, limit, skip, sortBy, sortOrder, sortOptions };
};
