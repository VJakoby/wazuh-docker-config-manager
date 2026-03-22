'use strict';

/**
 * Middleware that blocks unauthenticated requests to /api/* routes.
 * /api/auth/login and /api/auth/me are always public.
 */
function requireAuth(req, res, next) {
  // Always allow auth endpoints through
  if (req.path.startsWith('/api/auth/')) return next();

  // Allow health check through so the frontend can show connection status
  // even before login
  if (req.path === '/api/health') return next();

  // All other /api/* routes require a valid session
  if (req.path.startsWith('/api/') && !req.session?.authenticated) {
    return res.status(401).json({ error: 'Not authenticated', redirect: '/login' });
  }

  next();
}

module.exports = requireAuth;