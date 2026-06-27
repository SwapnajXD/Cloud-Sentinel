export default function CategorySummary({ reports }: any) {
  const latest = reports?.[0];

  let iam = 0;
  let s3 = 0;
  let ec2 = 0;

  for (const f of latest?.report?.findings || []) {
    if (f.type?.toLowerCase().includes("iam")) iam++;
    else if (f.type?.toLowerCase().includes("s3")) s3++;
    else if (f.type?.toLowerCase().includes("ec2")) ec2++;
  }

  return (
    <div className="bg-[#FFF2DB] p-6 rounded-xl shadow">
      <h2 className="text-lg font-semibold mb-4">📦 Resource Issues</h2>

      <div className="grid grid-cols-3 gap-4 text-center">
        <div>
          <p className="text-sm text-gray-600">IAM</p>
          <p className="text-2xl font-bold">{iam}</p>
        </div>

        <div>
          <p className="text-sm text-gray-600">S3</p>
          <p className="text-2xl font-bold">{s3}</p>
        </div>

        <div>
          <p className="text-sm text-gray-600">EC2</p>
          <p className="text-2xl font-bold">{ec2}</p>
        </div>
      </div>
    </div>
  );
}