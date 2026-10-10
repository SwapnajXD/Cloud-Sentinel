import { Notice } from './primitives';

export function DemoNotice() {
  return <Notice tone="warning"><strong>Demo data.</strong> This report uses fictional resources generated locally. No AWS account was scanned.</Notice>;
}
