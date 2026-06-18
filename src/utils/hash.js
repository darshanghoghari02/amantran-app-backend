import crypto from 'crypto';

/**
 * Hash password using PBKDF2 (native Node crypto, secure, zero compile-dependencies)
 * @param {string} password 
 * @returns {string}
 */
export function hashPassword(password) {
  if (!password) return '';
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `pbkdf2$1000$${salt}$${hash}`;
}

/**
 * Verify a plain text password against a hashed password
 * @param {string} password 
 * @param {string} hashedPassword 
 * @returns {boolean}
 */
export function verifyPassword(password, hashedPassword) {
  if (!password || !hashedPassword) return false;
  
  // Fallback for legacy plain text passwords in database
  if (!hashedPassword.startsWith('pbkdf2$')) {
    return password === hashedPassword;
  }
  
  const parts = hashedPassword.split('$');
  if (parts.length !== 4) return false;
  
  const iterations = parseInt(parts[1], 10);
  const salt = parts[2];
  const hash = parts[3];
  
  const testHash = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
  return hash === testHash;
}
