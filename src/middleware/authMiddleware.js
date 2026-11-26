const jwt = require('jsonwebtoken');

function requireAuth(request, response, next) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return response.status(401).json({ message: 'Authentication is required.' });

  try {
    request.auth = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch {
    return response.status(401).json({ message: 'Invalid or expired authentication token.' });
  }
}

function requireAdmin(request, response, next) {
  if (request.auth?.role !== 'admin') return response.status(403).json({ message: 'Admin access is required.' });
  return next();
}

function requireMemberOrAdmin(request, response, next) {
  if (!request.auth || !['admin', 'member'].includes(request.auth.role)) {
    return response.status(403).json({ message: 'Access denied.' });
  }
  return next();
}

module.exports = { requireAdmin, requireAuth, requireMemberOrAdmin };
