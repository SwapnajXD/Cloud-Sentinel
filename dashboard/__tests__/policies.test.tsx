import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import Policies from '@/components/console/policies';
import { useScopedData } from '@/components/console/overview';
import { createPolicy, evaluateStoredPolicy, getPolicies } from '@/lib/api';
import { useWorkspace } from '@/components/console/workspace';

jest.mock('@/components/console/overview', () => ({ useScopedData: jest.fn() }));
jest.mock('@/components/console/workspace', () => ({ useWorkspace: jest.fn() }));
jest.mock('@/lib/auth-context', () => ({ useAuth: () => ({ token: 'test-token' }) }));
jest.mock('@/lib/api', () => ({
  createPolicy: jest.fn(), evaluateStoredPolicy: jest.fn(), getPolicies: jest.fn(),
}));

const sampleReport = {
  id: 42, created_at: '2026-10-04T10:00:00Z',
  report: { findings: [{ id: 'finding-1', type: 'BucketPublic', category: 'S3', resource: 'public-bucket', status: 'FAIL', severity: 'critical' }] },
};
const samplePolicy = { id: 3, name: 'critical-failures', version: 1, description: 'Critical findings', source_yaml: 'apiVersion: cloud-sentinel/v1', created_at: '2026-10-04T10:00:00Z' };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useScopedData).mockReturnValue({ reports: [sampleReport], loading: false } as ReturnType<typeof useScopedData>);
  jest.mocked(useWorkspace).mockReturnValue({ refresh: jest.fn() } as unknown as ReturnType<typeof useWorkspace>);
  jest.mocked(getPolicies).mockResolvedValue({ policies: [] });
  jest.mocked(createPolicy).mockResolvedValue(samplePolicy);
  jest.mocked(evaluateStoredPolicy).mockResolvedValue({ policy: { name: samplePolicy.name, version: 1, severity: 'high', remediation: 'Restrict access.' }, report_id: 42,
    matches: [{ finding_id: 'finding-1', type: 'BucketPublic', resource: 'public-bucket', matched_on: [{ field: 'status', op: 'equals', value: 'FAIL', actual: 'FAIL' }] }] });
});

it('creates an immutable version and displays explained report matches', async () => {
  render(<Policies/>);
  expect(await screen.findByRole('heading', { name: 'Write a policy' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Saved assessment' })).toHaveValue('42');
  fireEvent.click(screen.getByRole('button', { name: 'Save policy version' }));
  expect(await screen.findByText('Saved critical-failures version 1. Policy versions are immutable.')).toBeInTheDocument();
  await waitFor(() => expect(createPolicy).toHaveBeenCalledWith('test-token', expect.stringContaining('apiVersion: cloud-sentinel/v1')));
  fireEvent.click(screen.getByRole('button', { name: 'Evaluate' }));
  expect(await screen.findByRole('heading', { name: 'critical-failures · v1' })).toBeInTheDocument();
  const results = screen.getByRole('table', { name: 'Policy evaluation matches' });
  expect(within(results).getByText('public-bucket')).toBeInTheDocument();
  expect(within(results).getByText(/status equals/)).toBeInTheDocument();
  expect(within(results).getByRole('link', { name: 'BucketPublic' })).toHaveAttribute('href', '/findings?report=42&finding=finding-1');
});

it('explains that a saved report is needed before evaluation', async () => {
  jest.mocked(useScopedData).mockReturnValue({ reports: [], loading: false } as unknown as ReturnType<typeof useScopedData>);
  render(<Policies/>);
  expect(await screen.findByRole('heading', { name: 'No saved assessments' })).toBeInTheDocument();
  expect(screen.getByText(/Run an assessment before evaluating a policy\. Evaluation never starts a scan\./)).toBeInTheDocument();
});
