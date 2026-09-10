import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

const secret = process.env.JWT_SECRET;
if (!secret || (process.env.NODE_ENV !== 'test' && (secret.length < 32 || secret.startsWith('change-me')))) {
  throw new Error('JWT_SECRET must contain at least 32 characters of securely generated randomness');
}
const JWT_SECRET: string = secret;
export interface TokenPayload { id: number; email: string; iat?: number; exp?: number }
export function signToken(payload: Omit<TokenPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h', algorithm: 'HS256' });
}
export function authenticateJWT(req: Request, res: Response, next: NextFunction): void {
  const match = /^Bearer ([^ ]+)$/.exec(req.headers.authorization || '');
  if (!match) { res.status(401).json({ error: 'missing token' }); return; }
  try {
    const payload = jwt.verify(match[1], JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || !Number.isSafeInteger(payload.id) || payload.id < 1 || typeof payload.email !== 'string' || !payload.exp) {
      throw new Error('invalid claims');
    }
    req.user = payload as TokenPayload;
    next();
  } catch { res.status(401).json({ error: 'invalid token' }); }
}
