import { fireEvent, render, screen, within } from '@testing-library/react';
import Query from '@/components/console/query';
import { useScopedData } from '@/components/console/overview';

jest.mock('@/components/console/overview', () => ({ useScopedData: jest.fn() }));

beforeEach(() => {
  jest.mocked(useScopedData).mockReturnValue({ loading: false, reports: [{
    id: 12, created_at: '2026-10-08T12:00:00Z', report: { context: { account_id: '123456789012', connection_id: null, region: 'us-east-1', mode: 'aws', services: ['s3'] }, findings: [
      { id: 'finding-1', type: 'BucketPublic', category: 'S3', resource: 'public-bucket', title: 'Public bucket', status: 'FAIL', severity: 'critical' },
    ] },
  }] } as unknown as ReturnType<typeof useScopedData>);
});

it('runs a saved-report query and links rows back to their evidence', () => {
  render(<Query/>);
  expect(screen.getByRole('heading', { name: 'Query' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Run query' }));
  const table = screen.getByRole('table', { name: 'Query results' });
  expect(within(table).getByText('public-bucket')).toBeInTheDocument();
  expect(within(table).getByRole('link', { name: 'finding-1' })).toHaveAttribute('href', '/findings?report=12&finding=finding-1');
});

it('reports unsupported query syntax without executing it', () => {
  render(<Query/>);
  fireEvent.change(screen.getByRole('textbox', { name: 'Query text' }), { target: { value: 'SELECT * FROM users' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run query' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Expected findings.');
  expect(screen.queryByRole('table', { name: 'Query results' })).not.toBeInTheDocument();
});
