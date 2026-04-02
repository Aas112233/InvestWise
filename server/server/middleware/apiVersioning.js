/**
 * API Versioning Middleware
 * Supports multiple versioning strategies:
 * 1. URL Path: /api/v1/users
 * 2. Header: X-API-Version: 1
 * 3. Query Param: /api/users?version=1
 */

const API_VERSION = 'v1';
const SUPPORTED_VERSIONS = ['v1'];
const DEPRECATED_VERSIONS = []; // Add versions here when deprecating

/**
 * Extract version from request
 * Priority: URL Path > Header > Query Param > Default
 */
const extractVersion = (req) => {
  // 1. Check URL path (/api/v1/...)
  const pathMatch = req.path.match(/\/api\/(v\d+)/);
  if (pathMatch && pathMatch[1]) {
    return pathMatch[1];
  }

  // 2. Check custom header (X-API-Version: v1)
  const headerVersion = req.get('X-API-Version');
  if (headerVersion) {
    return headerVersion;
  }

  // 3. Check query parameter (?version=v1)
  if (req.query.version) {
    return req.query.version;
  }

  // 4. Default version
  return API_VERSION;
};

/**
 * Check if version is supported
 */
const isVersionSupported = (version) => {
  return SUPPORTED_VERSIONS.includes(version);
};

/**
 * Check if version is deprecated
 */
const isVersionDeprecated = (version) => {
  return DEPRECATED_VERSIONS.includes(version);
};

/**
 * Get deprecation warning for version
 */
const getDeprecationWarning = (version) => {
  const deprecationInfo = {
    v1: {
      deprecated: false,
      sunset: null,
      message: null,
    },
    // Add deprecation info for future versions
    // v2: {
    //   deprecated: true,
    //   sunset: '2026-06-01',
    //   message: 'API v2 is deprecated. Please migrate to v3.',
    // }
  };

  return deprecationInfo[version] || {
    deprecated: false,
    sunset: null,
    message: null,
  };
};

/**
 * API Versioning Middleware
 * Adds version info to request and response
 */
const apiVersioning = (req, res, next) => {
  const version = extractVersion(req);
  
  // Attach version to request
  req.apiVersion = version;
  
  // Check if version is supported
  if (!isVersionSupported(version)) {
    return res.status(400).json({
      success: false,
      error: 'UNSUPPORTED_VERSION',
      message: `API version '${version}' is not supported.`,
      supportedVersions: SUPPORTED_VERSIONS,
    });
  }
  
  // Add deprecation warning if applicable
  if (isVersionDeprecated(version)) {
    const warning = getDeprecationWarning(version);
    res.set('Deprecation', 'true');
    
    if (warning.sunset) {
      res.set('Sunset', warning.sunset);
    }
    
    res.set('Warning', `299 - "API ${version} is deprecated. ${warning.message}"`);
  }
  
  // Add version info to response headers
  res.set('X-API-Version', version);
  res.set('X-Supported-Versions', SUPPORTED_VERSIONS.join(', '));
  
  next();
};

/**
 * Version-specific route wrapper
 * Allows different implementations for different versions
 * 
 * Usage:
 * router.get('/users', versionedRoute({
 *   v1: v1Controller.getUsers,
 *   v2: v2Controller.getUsers,
 *   default: v1Controller.getUsers
 * }));
 */
const versionedRoute = (versionHandlers) => {
  return (req, res, next) => {
    const version = req.apiVersion || API_VERSION;
    const handler = versionHandlers[version] || versionHandlers.default;
    
    if (!handler) {
      return res.status(400).json({
        success: false,
        error: 'NO_HANDLER_FOR_VERSION',
        message: `No handler configured for API version '${version}'.`,
      });
    }
    
    return handler(req, res, next);
  };
};

/**
 * Normalize path to remove version prefix
 * Converts /api/v1/users to /users for internal routing
 */
const normalizePath = (path, version) => {
  return path.replace(`/api/${version}`, '').replace('/api', '');
};

/**
 * Get current version from package.json or config
 */
const getAppVersion = () => {
  try {
    const pkg = require('../package.json');
    return pkg.version || '1.0.0';
  } catch {
    return '1.0.0';
  }
};

/**
 * Versioned response wrapper
 * Adds version metadata to all responses
 */
const versionedResponse = (req, res, data) => {
  return {
    version: req.apiVersion || API_VERSION,
    timestamp: new Date().toISOString(),
    ...data,
  };
};

/**
 * Deprecation middleware
 * Adds deprecation headers and warnings
 */
const deprecationMiddleware = (req, res, next) => {
  const version = req.apiVersion || API_VERSION;
  const warning = getDeprecationWarning(version);
  
  if (warning.deprecated) {
    res.set('Deprecation', 'true');
    
    if (warning.sunset) {
      res.set('Sunset', warning.sunset);
    }
    
    // Add warning header
    const warningMessage = warning.message || `API ${version} is deprecated`;
    res.set('Warning', `299 - "${warningMessage}"`);
  }
  
  next();
};

export {
  API_VERSION,
  SUPPORTED_VERSIONS,
  DEPRECATED_VERSIONS,
  apiVersioning,
  versionedRoute,
  normalizePath,
  getAppVersion,
  versionedResponse,
  deprecationMiddleware,
  extractVersion,
  isVersionSupported,
  isVersionDeprecated,
  getDeprecationWarning,
};

export default apiVersioning;
