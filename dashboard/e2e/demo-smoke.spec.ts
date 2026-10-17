import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('owner can inspect fictional report evidence across the console', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: /Initialize your workspace|Welcome back/ })).toBeVisible();
  const register = await page.getByRole('heading', { name: 'Initialize your workspace' }).isVisible();
  await page.getByLabel('Email address').fill('demo-smoke@example.invalid');
  await page.getByLabel('Password').fill('demo-smoke-password-123');
  await page.getByRole('button', { name: register ? 'Create owner account' : 'Sign in to workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Security overview' })).toBeVisible();

  execFileSync(process.env.E2E_PYTHON || 'python3', ['../../worker/demo_data.py', '--seed'], {
    cwd: __dirname,
    env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL },
  });
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'No AWS account was scanned' }).first()).toBeVisible();
  await expect(page.getByRole('img', { name: /Security scores from oldest to newest/ })).toBeVisible();

  await page.goto('/reports');
  await expect(page.getByText('Demo data · No AWS scan')).toHaveCount(2);
  await page.getByRole('link', { name: /Assessment #/ }).first().click();
  await expect(page.getByRole('status').filter({ hasText: 'No AWS account was scanned' }).first()).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Offline HTML' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^cloud-sentinel-report-\d+\.html$/);
  expect(readFileSync(await download.path(), 'utf8')).toContain('DEMO DATA · Fictional resources · No AWS account was scanned');

  await page.goto('/compliance');
  const controls = page.getByRole('table', { name: 'CIS controls' });
  await expect(controls.getByRole('row').filter({ hasText: 'Root account MFA' }).getByText('Pass')).toBeVisible();
  await expect(controls.getByRole('row').filter({ hasText: 'Restrict remote administration ingress' }).getByText('Fail')).toBeVisible();
  await controls.getByRole('link', { name: 'Administrative ingress open to the internet' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Administrative ingress open to the internet' })).toBeVisible();

  await page.goto('/findings');
  await page.getByRole('button', { name: 'Potential public administrative access path' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Potential attack path' })).toBeVisible();
  await expect(page.getByRole('dialog').getByText(/Network ACLs/)).toBeVisible();
});
