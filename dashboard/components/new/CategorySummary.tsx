import { motion } from "framer-motion";

interface CategorySummaryProps {
  reports: any[];
  activeFilter: string;
  setFilter: (filter: string) => void;
}

export default function CategorySummary({ reports, activeFilter, setFilter }: CategorySummaryProps) {
  const latest = reports?.[0];

  let iam = 0;
  let s3 = 0;
  let ec2 = 0;

  for (const f of latest?.report?.findings || []) {
    if (f.type?.toLowerCase().includes("iam")) iam++;
    else if (f.type?.toLowerCase().includes("s3")) s3++;
    else if (f.type?.toLowerCase().includes("ec2")) ec2++;
  }

  const resourceTypes = [
    { id: "iam", label: "IAM", count: iam },
    { id: "s3", label: "S3", count: s3 },
    { id: "ec2", label: "EC2", count: ec2 },
  ];

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card-bg border border-black/10 dark:border-white/10 p-6 rounded-xl shadow-xl shadow-neutral-200/40 dark:shadow-black/30 transition-all duration-200"
    >
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-sm font-bold flex items-center gap-2 tracking-wide uppercase">📦 Resource Issues</h2>
        {["iam", "s3", "ec2"].includes(activeFilter) && (
          <button 
            onClick={() => setFilter("all")} 
            className="text-xs bg-critical/10 text-critical border border-critical/20 font-bold px-2 py-1 rounded-md hover:bg-critical/20 transition"
          >
            Clear Filter ×
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4 text-center">
        {resourceTypes.map((res) => (
          <motion.button
            key={res.id}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={() => setFilter(activeFilter === res.id ? "all" : res.id)}
            className={`p-3 rounded-lg border transition-all duration-150 focus:outline-none text-left w-full shadow-sm ${
              activeFilter === res.id
                ? "bg-background border-critical ring-1 ring-critical/20"
                : "bg-background/40 border-black/5 dark:border-white/5 hover:bg-background/80"
            }`}
          >
            <p className="text-sm text-gray-500 dark:text-gray-400 font-semibold text-center">{res.label}</p>
            <p className="text-2xl font-bold mt-1 text-foreground text-center tracking-tight">{res.count}</p>
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}