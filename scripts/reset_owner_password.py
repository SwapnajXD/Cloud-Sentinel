#!/usr/bin/env python3
"""Reset the existing owner's password through the running gateway container."""
import argparse
import getpass
import json
import subprocess
import sys
import warnings
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
RESET_SCRIPT = r"""
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
(async () => {
  let client;
  try {
    const { email, password } = JSON.parse(fs.readFileSync(0, 'utf8'));
    if (typeof email !== 'string' || typeof password !== 'string' ||
        password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
      throw new Error('Invalid reset input');
    }
    const hash = await bcrypt.hash(password, 12);
    client = await pool.connect();
    await client.query('BEGIN');
    const owners = await client.query('SELECT id,email FROM users FOR UPDATE');
    if (owners.rows.length !== 1 || owners.rows[0].email.toLowerCase() !== email) {
      throw new Error('The installation must have exactly one owner matching the supplied email');
    }
    await client.query('UPDATE users SET password=$1 WHERE id=$2', [hash, owners.rows[0].id]);
    await client.query('COMMIT');
    console.log('Password reset for ' + email + '. Sign in with your new password.');
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Password reset failed: ' + (error.code || error.message));
    process.exitCode = 1;
  } finally {
    if (client) client.release();
    await pool.end();
  }
})();
"""


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('email', help='Existing owner email')
    parser.add_argument('--sudo', action='store_true', help='Run Docker through sudo')
    args = parser.parse_args(argv)
    email = args.email.strip().lower()
    try:
        if args.sudo:
            subprocess.run(['sudo', '-v'], check=True)
        with warnings.catch_warnings():
            # Refuse an input environment where getpass would echo the password.
            warnings.simplefilter('error', getpass.GetPassWarning)
            password = getpass.getpass('New Cloud-Sentinel password (at least 12 characters): ')
            confirmation = getpass.getpass('Repeat new password: ')
        if password != confirmation:
            print('Passwords do not match. Nothing changed.', file=sys.stderr)
            return 1
        if len(password) < 12 or len(password.encode('utf-8')) > 72:
            print('Use at least 12 characters and at most 72 UTF-8 bytes. Nothing changed.', file=sys.stderr)
            return 1
        command = (['sudo', '-n'] if args.sudo else []) + [
            'docker', 'compose', '--env-file', 'infra/.env', '-f', 'infra/docker-compose.yml',
            'exec', '-T', 'gateway', 'node', '-e', RESET_SCRIPT,
        ]
        result = subprocess.run(command, cwd=PROJECT_ROOT,
                                input=json.dumps({'email': email, 'password': password}), text=True)
        return result.returncode
    except (EOFError, KeyboardInterrupt, getpass.GetPassWarning):
        print('\nReset cancelled; a private terminal prompt is required.', file=sys.stderr)
        return 1
    except (OSError, subprocess.CalledProcessError) as error:
        print(f'Unable to run password reset: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
