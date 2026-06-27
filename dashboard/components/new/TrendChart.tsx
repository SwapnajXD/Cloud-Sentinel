"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export default function TrendChart({ reports }: any) {
  const data = (reports || [])
    .map((r: any) => {
      let critical = 0;

      for (const f of (r.report?.findings || [])) {
        if (f.severity === "critical") critical++;
      }

      return {
        time: new Date(r.created_at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        critical,
      };
    })
    .reverse();

  return (
    <div className="bg-[#FFF2DB] p-6 rounded-xl shadow">
      <h2 className="text-lg font-semibold mb-4">
        📈 Critical Issues Over Time
      </h2>

      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={data}>
          <XAxis dataKey="time" />
          <YAxis allowDecimals={false} />
          <Tooltip
            contentStyle={{
              backgroundColor: "#FFF2DB",
              borderRadius: "10px",
            }}
          />
          <Line
            type="monotone"
            dataKey="critical"
            stroke="#F62440"
            strokeWidth={3}
            dot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}