// backend/utils/auth.js
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'barber2026';
const JWT_EXPIRES_IN = '12h';

/**
 * Generar hash de contraseña con bcrypt
 * @param {string} password - Contraseña en texto plano
 * @returns {Promise<string>} Hash de contraseña
 */
async function hashPassword(password) {
  return await bcrypt.hash(password, 10);
}

/**
 * Verificar contraseña contra hash
 * @param {string} password - Contraseña en texto plano
 * @param {string} hash - Hash almacenado en BD
 * @returns {Promise<boolean>} true si coincide
 */
async function verifyPassword(password, hash) {
  return await bcrypt.compare(password, hash);
}

/**
 * Generar token JWT para usuario autenticado
 * @param {object} user - Datos del usuario (id, role, branch_id)
 * @returns {string} Token JWT firmado
 */
function generateToken(user) {
  return jwt.sign(
    { 
      id: user.id, 
      role: user.role, 
      branch_id: user.branch_id,
      email: user.email 
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * Verificar y decodificar token JWT
 * @param {string} token - Token JWT recibido
 * @returns {object|null} Payload decodificado o null si es inválido
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken,
  JWT_SECRET
};