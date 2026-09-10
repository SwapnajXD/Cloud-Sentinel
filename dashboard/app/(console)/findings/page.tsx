import { Suspense } from 'react';
import Findings from '@/components/console/findings';
import { Loading } from '@/components/console/primitives';
export default function Page() { return <Suspense fallback={<Loading/>}><Findings/></Suspense>; }
