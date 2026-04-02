import helmet from 'helmet';

/**
 * Security Headers Middleware
 * Implements comprehensive security headers for production
 */
const securityHeaders = helmet({
  // Content Security Policy
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'", // Required for some React apps - consider nonce in production
        "'unsafe-eval'",   // Required for some libraries - remove if possible
        'https://cdn.jsdelivr.net', // If using external scripts
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'", // Required for inline styles
        'https://fonts.googleapis.com',
        'https://cdn.jsdelivr.net',
      ],
      fontSrc: [
        "'self'",
        'https://fonts.gstatic.com',
        'https://cdn.jsdelivr.net',
      ],
      imgSrc: [
        "'self'",
        'data:',
        'blob:',
        'https:',
        'http:',
      ],
      connectSrc: [
        "'self'",
        'https://api.ipify.org', // If using IP geolocation
      ],
      frameSrc: [
        "'self'",
        'https://www.youtube.com',
        'https://www.youtube-nocookie.com',
      ],
      frameAncestors: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
      blockAllMixedContent: [],
    },
  },

  // HTTP Strict Transport Security (HSTS)
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },

  // Prevent clickjacking
  frameguard: {
    action: 'sameorigin',
  },

  // Prevent MIME type sniffing
  noSniff: true,

  // XSS Protection (legacy but still useful)
  xssFilter: true,

  // Referrer Policy
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin',
  },

  // Permissions Policy (formerly Feature Policy)
  permissionsPolicy: {
    features: {
      camera: [],
      microphone: [],
      geolocation: [],
      payment: [],
      usb: [],
      magnetometer: [],
      gyroscope: [],
      accelerometer: [],
    },
  },

  // Cross-Origin Policies
  crossOriginEmbedderPolicy: false, // Required for some images to load
  crossOriginOpenerPolicy: true,
  crossOriginResourcePolicy: { policy: 'same-site' },

  // DNS Prefetch Control (privacy)
  dnsPrefetchControl: {
    allow: false,
  },

  // IE No Open (prevent IE from executing downloads in site's context)
  ieNoOpen: true,
});

/**
 * Additional Security Headers not covered by Helmet
 */
const additionalSecurityHeaders = (req, res, next) => {
  // Prevent caching of sensitive data
  if (req.path.startsWith('/api/')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }

  // Additional security headers
  res.set('X-Download-Options', 'noopen');
  res.set('X-Permitted-Cross-Domain-Policies', 'none');
  res.set('X-DNS-Prefetch-Control', 'off');
  
  // Remove server header (information disclosure)
  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');

  next();
};

/**
 * Development vs Production Security Configuration
 */
const getSecurityConfig = () => {
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    return {
      helmet: securityHeaders,
      additional: additionalSecurityHeaders,
    };
  }

  // Development: Less restrictive for debugging
  const devHelmet = helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'http:'],
        connectSrc: ["'self'", 'http://localhost:*', 'https://localhost:*'],
        frameAncestors: ["'self'"],
      },
    },
    hsts: false, // Disable HSTS in development
    frameguard: { action: 'sameorigin' },
    noSniff: true,
    xssFilter: true,
  });

  return {
    helmet: devHelmet,
    additional: additionalSecurityHeaders,
  };
};

export { securityHeaders, additionalSecurityHeaders, getSecurityConfig };
export default securityHeaders;
