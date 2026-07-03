import { setAppContext } from '../db/connection.js';

/**
 * Middleware that sets PostgreSQL session variables (app.user_id, app.role)
 * for Row Level Security enforcement.
 *
 * Must run AFTER the `protect` auth middleware so req.user is populated.
 * For unauthenticated routes, it sets empty context (RLS blocks access).
 *
 * Vercel serverless: SET LOCAL is connection-scoped. Each invocation
 * gets a connection from the Supabase pooler (session mode, port 5432)
 * and the setting is automatically cleared when returned to the pool.
 */
const rlsContext = async (req, res, next) => {
  try {
    if (req.user) {
      // Handle both Mongoose (_id) and Drizzle (id) user objects
      const userId = String(req.user._id || req.user.id);
      const role = req.user.role || 'Member';
      await setAppContext(userId, role);
    } else {
      // No authenticated user — clear context
      await setAppContext(null, null);
    }
  } catch (error) {
    // Log but don't block — RLS will simply deny access if context is missing
    console.error('RLS context middleware error:', error.message);
  }
  next();
};

export default rlsContext;
