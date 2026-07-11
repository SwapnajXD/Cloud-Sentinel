import { signToken, authenticateJWT, TokenPayload } from '../gateway/src/lib/auth';
import { Request, Response, NextFunction } from 'express';

describe('auth helpers', () => {
  test('signToken returns a string token and authenticateJWT accepts it', () => {
    const token: string = signToken({ id: 42, email: 'test@example.com' });
    expect(typeof token).toBe('string');

    // mock req/res/next
    const req = { headers: { authorization: `Bearer ${token}` } } as Partial<Request>;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as Partial<Response>;
    const next = jest.fn() as NextFunction;

    authenticateJWT(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
    expect((req as any).user).toBeDefined();
    expect((req as any).user.email).toBe('test@example.com');
  });

  test('authenticateJWT rejects missing or invalid token', () => {
    const req1 = { headers: {} } as Partial<Request>;
    const res1 = { status: jest.fn().mockReturnThis(), json: jest.fn() } as Partial<Response>;
    const next1 = jest.fn() as NextFunction;
    authenticateJWT(req1 as Request, res1 as Response, next1);
    expect(res1.status).toHaveBeenCalledWith(401);

    const req2 = { headers: { authorization: 'Bearer invalid.token.here' } } as Partial<Request>;
    const res2 = { status: jest.fn().mockReturnThis(), json: jest.fn() } as Partial<Response>;
    const next2 = jest.fn() as NextFunction;
    authenticateJWT(req2 as Request, res2 as Response, next2);
    expect(res2.status).toHaveBeenCalledWith(401);
  });
});
