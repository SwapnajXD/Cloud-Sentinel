import { render, screen, within } from '@testing-library/react';
import type { Finding, ReportRow } from '@/lib/api';
import Compliance, { buildControlRows } from '@/components/console/compliance';
import { useScopedData } from '@/components/console/overview';
import { formatDate } from '@/lib/presentation';

jest.mock('@/components/console/overview', () => ({ useScopedData: jest.fn() }));
const mockScopedData = jest.mocked(useScopedData);
const finding = (control: string, overrides: Partial<Finding> = {}): Finding => ({
  id: `finding-${control}`, type: 'security_check', title: `Check ${control}`,
  resource: `resource-${control}`, severity: 'good', status: 'PASS',
  cis: { control_id: control, control_title: `Control ${control}`, version: '3.0.0' },
  ...overrides,
});
const report = (findings: Finding[]): ReportRow => ({
  id: 42, created_at: '2026-10-04T10:00:00Z',
  report: {
    findings,
    context: { account_id: '123456789012', connection_id: 1, region: 'us-east-1', mode: 'full', services: ['IAM'] },
    cis_summary: { version: '3.0.0', controls_assessed: 2, controls_passing: 1, controls_failing: 1 },
  },
});
function setData(reports: ReportRow[] = [], loading = false) {
  // The page consumes only these two fields of the workspace data.
  mockScopedData.mockReturnValue({ reports, loading } as ReturnType<typeof useScopedData>);
}

describe('buildControlRows', () => {
  it('excludes unmapped findings', () => {
    expect(buildControlRows([finding('1.1', { cis: undefined })])).toEqual([]);
  });
  it('groups findings under one control and passes only when all pass', () => {
    const findings = [finding('1.1'), finding('1.1', { id: 'second', resource: 'another-resource' })];
    expect(buildControlRows(findings)).toEqual([{
      control_id: '1.1', control_title: 'Control 1.1', findings, status: 'PASS',
    }]);
  });
  it.each([['PASS', 'FAIL'], ['FAIL', 'PASS'], ['UNKNOWN', 'FAIL']] as const)('fails for %s and %s evidence', (first, second) => {
    expect(buildControlRows([finding('1.1', { status: first }), finding('1.1', { status: second })])[0].status).toBe('FAIL');
  });
  it.each(['UNKNOWN', 'SKIPPED', undefined] as const)('does not treat %s evidence as a pass', status => {
    expect(buildControlRows([finding('1.1'), finding('1.1', { status })])[0].status).toBe('UNKNOWN');
  });
  it('sorts control IDs numerically without mutating the input', () => {
    const findings = [finding('2.1'), finding('1.10'), finding('1.2')];
    expect(buildControlRows(findings).map(row => row.control_id)).toEqual(['1.2', '1.10', '2.1']);
    expect(findings.map(f => f.cis?.control_id)).toEqual(['2.1', '1.10', '1.2']);
  });
});

describe('Compliance', () => {
  beforeEach(() => jest.clearAllMocks());
  it('shows the loading state', () => {
    setData([], true);
    render(<Compliance/>);
    expect(screen.getByRole('status')).toHaveTextContent('Loading workspace');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it('shows an empty state before the first report', () => {
    setData();
    render(<Compliance/>);
    expect(screen.getByRole('heading', { name: 'No assessments yet' })).toBeInTheDocument();
  });
  it('identifies fictional report evidence before showing controls', () => {
    const latest = report([finding('1.2')]);
    latest.report.demo = true;
    setData([latest]);
    render(<Compliance/>);
    expect(screen.getByRole('status')).toHaveTextContent('No AWS account was scanned');
    expect(screen.getByRole('table', { name: 'CIS controls' })).toBeInTheDocument();
  });
  it('shows latest scope, aggregate coverage, control badges and finding links', () => {
    const latest = report([finding('1.2'), finding('1.10', { status: 'FAIL', id: 'failed/id&value' }), finding('2.1', { cis: undefined })]);
    setData([latest, { ...report([finding('9.9')]), id: 41 }]);
    render(<Compliance/>);
    expect(screen.getByText(`123456789012 · us-east-1 · ${formatDate(latest.created_at)}`)).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 assessed controls passing')).toBeInTheDocument();
    const rows = within(screen.getByRole('table', { name: 'CIS controls' })).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText('Pass')).toHaveClass('badge-pass');
    expect(within(rows[2]).getByText('Fail')).toHaveClass('badge-fail');
    expect(screen.getByRole('link', { name: 'Check 1.2' })).toHaveAttribute('href', '/findings?report=42&finding=finding-1.2');
    expect(screen.getByRole('link', { name: 'Check 1.10' })).toHaveAttribute('href', '/findings?report=42&finding=failed%2Fid%26value');
    expect(screen.getByText('resource-1.2')).toBeInTheDocument();
    expect(screen.queryByText('Control 2.1')).not.toBeInTheDocument();
    expect(screen.queryByText('Control 9.9')).not.toBeInTheDocument();
    expect(screen.getByText(/RDS\/Lambda findings are intentionally excluded/)).toBeInTheDocument();
  });
  it.each([undefined, { version: '3.0.0', controls_assessed: 0, controls_passing: 0, controls_failing: 0 }])('handles unavailable coverage without inventing a percentage', summary => {
    const latest = report([]);
    latest.report.cis_summary = summary;
    setData([latest]);
    render(<Compliance/>);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText(/No CIS-mapped findings/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
