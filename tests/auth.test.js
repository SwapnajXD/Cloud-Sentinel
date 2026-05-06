const { signToken, authenticateJWT } = require('../lib/auth');

describe('auth helpers', () => {
  test('signToken returns a string token and authenticateJWT accepts it', () => {
    const token = signToken({ id: 42, email: 'test@example.com' });
    expect(typeof token).toBe('string');

    // mock req/res/next
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const next = jest.fn();

    authenticateJWT(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user.email).toBe('test@example.com');
  });

  test('authenticateJWT rejects missing or invalid token', () => {
    const req1 = { headers: {} };
    const res1 = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next1 = jest.fn();
    authenticateJWT(req1, res1, next1);
    expect(res1.status).toHaveBeenCalledWith(401);

    const req2 = { headers: { authorization: 'Bearer invalid.token.here' } };
    const res2 = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next2 = jest.fn();
    authenticateJWT(req2, res2, next2);
    expect(res2.status).toHaveBeenCalledWith(401);
  });
});
