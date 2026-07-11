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
    <div className="bg-cardBg border border-brandBorder backdrop-blur-sm p-6 rounded-xl shadow hover:shadow-xl hover:-translate-y-1 transition-all duration-200">
      <h2 className="text-lg font-semibold mb-4">
        📊 Severity Breakdown Over Time
      </h2>

      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <XAxis 
            dataKey="time" 
            tick={{ fill: "var(--foreground)" }} 
          />
          <YAxis 
            tick={{ fill: "var(--foreground)" }} 
          />
          <Tooltip 
            cursor={{ fill: 'transparent' }}
            contentStyle={{
              backgroundColor: "var(--card-bg)",
              borderColor: "var(--border-color)",
              borderRadius: "10px",
              color: "var(--foreground)",
            }}
          />
          {/* Map to CSS Variables instead of Hex codes */}
          <Bar dataKey="critical" stackId="a" fill="var(--color-critical)" />
          <Bar dataKey="medium" stackId="a" fill="var(--color-medium)" />
          <Bar dataKey="good" stackId="a" fill="var(--color-healthy)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}