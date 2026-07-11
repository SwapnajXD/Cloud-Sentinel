export function Badge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    critical: "bg-[#F62440]",
    medium: "bg-amber-500",
    good: "bg-green-600",
    info: "bg-blue-600",
  };

  const currentSeverity = severity?.toLowerCase() || "info";

  return (
    <span
      className={`text-white text-xs font-bold tracking-wide px-2 py-0.5 rounded-full shadow-sm ${
        colors[currentSeverity] || "bg-gray-500"
      }`}
    >
      {currentSeverity.toUpperCase()}
    </span>
  );
}