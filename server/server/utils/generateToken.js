import jwt from 'jsonwebtoken';

// Token expiration times
const ACCESS_TOKEN_EXPIRE = '15m';  // 15 minutes
const REFRESH_TOKEN_EXPIRE = '7d';   // 7 days

/**
 * Generate access token (short-lived)
 * @param {string} id - User ID
 * @returns {string} JWT access token
 */
const generateAccessToken = (id) => {
    return jwt.sign({ id, type: 'access' }, process.env.JWT_SECRET, {
        expiresIn: ACCESS_TOKEN_EXPIRE,
    });
};

/**
 * Generate refresh token (long-lived)
 * @param {string} id - User ID
 * @returns {string} JWT refresh token
 */
const generateRefreshToken = (id) => {
    return jwt.sign({ id, type: 'refresh' }, process.env.JWT_SECRET, {
        expiresIn: REFRESH_TOKEN_EXPIRE,
    });
};

/**
 * Generate both tokens
 * @param {string} id - User ID
 * @returns {{accessToken: string, refreshToken: string}}
 */
const generateTokenPair = (id) => {
    return {
        accessToken: generateAccessToken(id),
        refreshToken: generateRefreshToken(id),
    };
};

export { generateAccessToken, generateRefreshToken, generateTokenPair, ACCESS_TOKEN_EXPIRE, REFRESH_TOKEN_EXPIRE };
export default generateTokenPair;
