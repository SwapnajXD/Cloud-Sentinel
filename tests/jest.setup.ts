// Runs before test modules are imported. auth.ts throws at import time if
// JWT_SECRET isn't set, so tests need a value present first.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-do-not-use-in-prod';
