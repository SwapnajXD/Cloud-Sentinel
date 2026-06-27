"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export default function StackedSeverityChart({ reports }: any) {
  const data = (reports || [])
    .map((r: any) => {
      let critical = 0;
      let medium = 0;
      let good = 0;

      for (const f of r.report?.findings || []) {
        if (f.severity === "critical") critical++;
        else if (f.severity === "medium") medium++;
        else if (f.severity === "good") good++;
      }

      return {
        time: new Date(r.created_at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        critical,
        medium,
        good,
      };
    })
    .reverse();

  return (
    <div className="bg-[#FFF2DB] p-6 rounded-xl shadow">
      <h2 className="text-lg font-semibold mb-4">
        📊 Severity Breakdown Over Time
      </h2>

      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <XAxis dataKey="time" />
          <YAxis />
          <Tooltip />
          <Bar dataKey="critical" stackId="a" fill="#F62440" />
          <Bar dataKey="medium" stackId="a" fill="#facc15" />
          <Bar dataKey="good" stackId="a" fill="#22c55e" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}