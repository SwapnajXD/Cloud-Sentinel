import { authenticateJWT, signToken } from '../gateway/src/lib/auth';
import jwt from 'jsonwebtoken';
import { Request, Response } from 'express';
function verify(token?: string) {
  const req = { headers: { authorization: token ? `Bearer ${token}` : undefined } } as Request;
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
  const next = jest.fn(); authenticateJWT(req, res, next); return { req, res, next };
}
test('accepts signed owner token', () => { const result = verify(signToken({ id: 1, email: 'a@b.com' })); expect(result.next).toHaveBeenCalled(); expect(result.req.user?.id).toBe(1); });
test.each([undefined, 'invalid'])('rejects missing/invalid token', token => { expect(verify(token).res.status).toHaveBeenCalledWith(401); });
test.each([{ id: '1', email: 'a@b.com' }, { id: 1 }, { id: -1, email: 'a@b.com' }])('rejects invalid claims %j', claims => {
  expect(verify(jwt.sign(claims, process.env.JWT_SECRET!, { expiresIn: '1h' })).res.status).toHaveBeenCalledWith(401);
});
test('rejects expired tokens and wrong algorithms', () => {
  expect(verify(jwt.sign({ id: 1, email: 'a@b.com' }, process.env.JWT_SECRET!, { expiresIn: -1 })).res.status).toHaveBeenCalledWith(401);
  expect(verify(jwt.sign({ id: 1, email: 'a@b.com' }, process.env.JWT_SECRET!, { expiresIn: '1h', algorithm: 'HS384' })).res.status).toHaveBeenCalledWith(401);
});
