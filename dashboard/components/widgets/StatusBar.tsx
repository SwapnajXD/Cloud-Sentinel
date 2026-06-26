export default function StatusBar({
  status,
  loadingReports,
  loadingAction,
}: any) {
  return (
    <div className="bg-[#0a0a0f] border p-2 flex justify-between text-xs">
      <span>STATUS</span>
      <span>
        {loadingReports || loadingAction ? "PROCESSING..." : status}
      </span>
    </div>
  );
}
