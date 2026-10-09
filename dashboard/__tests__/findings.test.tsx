import { render, screen, within } from '@testing-library/react';
import { useSearchParams } from 'next/navigation';
import Findings from '@/components/console/findings';
import { useScopedData } from '@/components/console/overview';

jest.mock('next/navigation', () => ({ useSearchParams: jest.fn() }));
jest.mock('@/components/console/overview', () => ({ useScopedData: jest.fn() }));

it('opens a passing finding linked from Compliance despite the default failure filter', () => {
  jest.mocked(useSearchParams).mockReturnValue(new URLSearchParams('report=42&finding=passing') as ReturnType<typeof useSearchParams>);
  jest.mocked(useScopedData).mockReturnValue({
    loading: false,
    reports: [{ id: 42, created_at: '2026-10-04T10:00:00Z', report: { findings: [{
      id: 'passing', type: 'secure_check', title: 'Secure bucket', resource: 'bucket', status: 'PASS', severity: 'good',
    }] } }],
  } as ReturnType<typeof useScopedData>);
  // jsdom does not implement the native dialog methods.
  const showModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
  const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
  try {
    const { unmount } = render(<Findings/>);
    expect(screen.getByRole('combobox', { name: 'Check status' })).toHaveValue('all');
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: 'Secure bucket' })).toBeInTheDocument();
    unmount();
  } finally {
    if (showModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', showModal);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
    if (close) Object.defineProperty(HTMLDialogElement.prototype, 'close', close);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  }
});
