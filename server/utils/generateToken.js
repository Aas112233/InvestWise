import jwt from 'jsonwebtoken';

// Token expiration times
const ACCESS_TOKEN_EXPIRE = '15m'; // 15 minutes
const REFRESH_TOKEN_EXPIRE = '7d'; // 7 days

/**
 * Get the secret for the given token type.
 * Access and refresh tokens MUST use different secrets in production
 * to prevent a compromised access token from forging refresh tokens.
 */
const getSecret = (type = 'access') => {
 if (type === 'refresh') {
 return process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
 }
 return process.env.JWT_SECRET;
};

/**
 * Generate access token (short-lived)
 * @param {string} id - User ID
 * @returns {string} JWT access token
 */
const generateAccessToken = (id) => {
 return jwt.sign({ id, type: 'access' }, getSecret('access'), {
 expiresIn: ACCESS_TOKEN_EXPIRE,
 });
};

/**
 * Generate refresh token (long-lived)
 * @param {string} id - User ID
 * @returns {string} JWT refresh token
 */
const generateRefreshToken = (id) => {
 return jwt.sign({ id, type: 'refresh' }, getSecret('refresh'), {
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

export { generateAccessToken, generateRefreshToken, generateTokenPair, getSecret, ACCESS_TOKEN_EXPIRE, REFRESH_TOKEN_EXPIRE };
export default generateTokenPair;
