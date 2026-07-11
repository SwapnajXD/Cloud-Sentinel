"use client";

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export default function SeverityChart({ reports }: any) {
  const latest =
    Array.isArray(reports) && reports.length > 0
      ? reports[0]
      : null;

  let critical = 0;
  let medium = 0;
  let good = 0;

  if (latest && latest.report?.findings) {
    for (const f of latest.report.findings) {
      if (f.severity === "critical") critical++;
      else if (f.severity === "medium") medium++;
      else if (f.severity === "good") good++;
    }
  }

  const data = [
    { name: "Critical", value: critical, color: "#F62440" },
    { name: "Medium", value: medium, color: "#facc15" },
    { name: "Healthy", value: good, color: "#22c55e" },
  ];

  return (
    <div className="bg-cardBg border border-brandBorder backdrop-blur-sm p-6 rounded-xl shadow hover:shadow-xl hover:-translate-y-1 transition-all duration-200">
      <h2 className="text-lg font-semibold mb-4">
        📊 Severity Distribution
      </h2>

      <ResponsiveContainer width="100%" height={250}>
        <PieChart>
          <Pie 
            data={data} 
            dataKey="value" 
            outerRadius={80} 
            fill="#8884d8"
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--card-bg)",
              borderColor: "var(--border-color)",
              borderRadius: "10px",
              color: "var(--foreground)",
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}