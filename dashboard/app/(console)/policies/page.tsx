import { Suspense } from 'react';
import Policies from '@/components/console/policies';
import { Loading } from '@/components/console/primitives';
export default function Page() { return <Suspense fallback={<Loading/>}><Policies/></Suspense>; }
