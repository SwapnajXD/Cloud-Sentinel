export class ClientError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function id(value: unknown, name = 'id'): number {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) {
    throw new ClientError(`invalid ${name}`);
  }
  return Number(value);
}
export function text(value: unknown, name: string, max: number, min = 1): string {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) throw new ClientError(`invalid ${name}`);
  return value.trim();
}
export function password(value: unknown, registration = false): string {
  if (typeof value !== 'string' || value.length < (registration ? 12 : 1) || Buffer.byteLength(value, 'utf8') > 72) {
    throw new ClientError('password must be 12–72 UTF-8 bytes when creating an account; maximum 72 bytes for login');
  }
  return value;
}
export const SERVICES = ['s3', 'ec2', 'iam', 'rds', 'lambda'];
export function scanConfig(body: Record<string, unknown>) {
  const mode = body.mode ?? 'aws';
  if (mode !== 'aws' && mode !== 'floci') throw new ClientError('mode must be aws or floci');
  const region = text(body.region ?? process.env.AWS_REGION ?? 'us-east-1', 'region', 40);
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region)) throw new ClientError('invalid region');
  const services = body.services ?? SERVICES;
  if (!Array.isArray(services) || !services.length || services.some(s => typeof s !== 'string' || !SERVICES.includes(s))) throw new ClientError('invalid services');
  const connection_id = body.connection_id == null ? null : id(body.connection_id, 'connection_id');
  if (mode === 'floci' && connection_id) throw new ClientError('Floci does not use an AWS connection');
  return { mode, region, services: [...new Set(services)].sort(), connection_id };
}
