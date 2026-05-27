// backend/middleware/requireAuth.js
const { verifyToken } = require('../utils/auth');

/**
 * Middleware para proteger rutas que requieren autenticación
 * @param {string[]} allowedRoles - Roles permitidos (ej: ['admin'], ['barber', 'admin'])
 * @returns {Function} Middleware de Express
 */
function requireAuth(allowedRoles = []) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    // Verificar que se envió token
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token no proporcionado' });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    
    if (!decoded) {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }
    
    // Verificar roles si se especificaron
    if (allowedRoles.length > 0 && !allowedRoles.includes(decoded.role)) {
      return res.status(403).json({ error: 'Acceso denegado: rol no permitido' });
    }
    
    // Adjuntar usuario decodificado a la request para usar en la ruta
    req.user = decoded;
    next();
  };
}

module.exports = requireAuth;