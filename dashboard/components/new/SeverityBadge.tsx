export function Badge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    critical: "bg-red-500",
    medium: "bg-yellow-500",
    good: "bg-green-500",
    info: "bg-blue-500",
  };

  return (
    <span
      className={`text-white text-xs px-2 py-1 rounded ${
        colors[severity] || "bg-gray-500"
      }`}
    >
      {severity.toUpperCase()}
    </span>
  );
}