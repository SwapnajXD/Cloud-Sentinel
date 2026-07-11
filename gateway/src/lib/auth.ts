import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

// No insecure fallback: fail loudly at startup instead of silently signing
// tokens with a well-known default secret.
const rawSecret = process.env.JWT_SECRET;

if (!rawSecret) {
  throw new Error(
    'JWT_SECRET is not set. Set a strong, random value in your environment before starting the gateway.'
  );
}

// Re-bind to a definitely-string const so TS narrows it correctly in the
// functions below (module-level `if` checks don't narrow across closures).
const JWT_SECRET: string = rawSecret;

interface TokenPayload {
  id: number;
  email: string;
  iat?: number;
  exp?: number;
}

function signToken(payload: Omit<TokenPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

function authenticateJWT(req: Request, res: Response, next: NextFunction): Response<any> | void {
  const auth = req.headers && req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing token' });
  }
  const token = auth.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET) as TokenPayload;
    (req as any).user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'invalid token' });
  }
}

export { signToken, authenticateJWT, TokenPayload };
