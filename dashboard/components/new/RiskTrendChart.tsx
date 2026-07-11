"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export default function RiskTrendChart({ reports }: any) {
  const data = (reports || [])
    .map((r: any) => {
      let risk = 100;

      for (const f of (r.report?.findings || [])) {
        if (f.severity === "critical") risk -= 10;
        else if (f.severity === "medium") risk -= 5;
      }

      return {
        time: new Date(r.created_at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        risk: Math.max(risk, 0),
      };
    })
    .reverse();

  return (
    <div className="bg-cardBg border border-brandBorder backdrop-blur-sm p-6 rounded-xl shadow hover:shadow-xl hover:-translate-y-1 transition-all duration-200">
      <h2 className="text-lg font-semibold mb-4">📉 Risk Over Time</h2>

      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={data}>
          <XAxis dataKey="time" />
          <YAxis />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--card-bg)",
              borderColor: "var(--border-color)",
              borderRadius: "10px",
              color: "var(--foreground)",
            }}
          />
          <Line
            type="monotone"
            dataKey="risk"
            stroke="#F62440"
            strokeWidth={3}
            dot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}