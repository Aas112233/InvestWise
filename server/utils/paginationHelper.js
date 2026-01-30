/**
 * Formats a paginated response for the API
 * @param {Array} data - The slice of data for the current page
 * @param {number} page - Current page number
 * @param {number} limit - Items per page
 * @param {number} totalCount - Total number of items in the collection
 * @returns {Object} Standardised pagination object
 */
export const formatPaginatedResponse = (data, page, limit, totalCount) => {
    return {
        data,
        page: Number(page),
        pages: Math.ceil(totalCount / limit),
        total: totalCount,
        limit: Number(limit)
    };
};

/**
 * Parses pagination parameters from request query
 * @param {Object} query - req.query
 * @returns {Object} { page, limit, skip }
 */
export const getPaginationParams = (query) => {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const skip = (page - 1) * limit;

    return { page, limit, skip };
};
