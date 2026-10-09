import { Suspense } from 'react';
import Compliance from '@/components/console/compliance';
import { Loading } from '@/components/console/primitives';
export default function Page() { return <Suspense fallback={<Loading/>}><Compliance/></Suspense>; }
