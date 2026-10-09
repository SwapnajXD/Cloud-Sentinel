import { fireEvent, render, screen } from '@testing-library/react';
import { ScanDialog } from '@/components/console/scan-form';
import { useWorkspace } from '@/components/console/workspace';
import { queueAudit } from '@/lib/api';

jest.mock('@/components/console/workspace', () => ({ useWorkspace: jest.fn() }));
jest.mock('@/lib/auth-context', () => ({ useAuth: () => ({ token: 'test-token' }) }));
jest.mock('@/lib/api', () => ({ queueAudit: jest.fn() }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));

const mockWorkspace = jest.mocked(useWorkspace);

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute('open'); };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockWorkspace.mockReturnValue({
    connections: [], system: { region: 'ap-south-1', floci_configured: true,
      aws_credentials: { status: 'expired', error_code: 'ExpiredToken', checked_at: '2026-10-09T19:00:00Z' } },
    refresh: jest.fn(),
  } as unknown as ReturnType<typeof useWorkspace>);
});

it('warns and prevents AWS scans when the worker session is known to be expired', () => {
  render(<ScanDialog onClose={jest.fn()}/>);
  expect(screen.getByRole('alert')).toHaveTextContent('Worker AWS credentials have expired');
  expect(screen.getByRole('button', { name: 'Start scan' })).toBeDisabled();
  expect(queueAudit).not.toHaveBeenCalled();
});

it('does not require AWS credentials for the configured local emulator', () => {
  render(<ScanDialog onClose={jest.fn()}/>);
  fireEvent.change(screen.getByLabelText('Scan environment'), { target: { value: 'floci' } });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start scan' })).toBeEnabled();
});
