import { ReportDetail } from '@/components/console/reports';
export default function Page({ params }: { params: { id: string } }) { return <ReportDetail id={params.id}/>; }
