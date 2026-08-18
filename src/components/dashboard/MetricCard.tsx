import React from "react";
import { ArrowUpRight, ArrowDownRight, AlertTriangle, CheckCircle2 } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string | number;
  unit?: string;
  subtitle?: string;
  trend?: number; // e.g. +4.2 or -1.5
  status?: "NORMAL" | "WARNING" | "CRITICAL";
  icon: React.ElementType;
  progressPct?: number;
  engineBadge?: string;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  unit,
  subtitle,
  trend,
  status = "NORMAL",
  icon: Icon,
  progressPct,
  engineBadge,
}) => {
  const isCritical = status === "CRITICAL";
  const isWarning = status === "WARNING";

  const statusBg = isCritical
    ? "border-rose-500/40 bg-rose-500/5 dark:bg-rose-500/10"
    : isWarning
    ? "border-amber-500/40 bg-amber-500/5 dark:bg-amber-500/10"
    : "border-slate-200 bg-white dark:border-[#272a30] dark:bg-[#1a1d23]";

  const statusText = isCritical
    ? "text-rose-600 dark:text-rose-400"
    : isWarning
    ? "text-amber-600 dark:text-amber-400"
    : "text-slate-900 dark:text-white";

  const badgeBg = isCritical
    ? "bg-rose-500/20 text-rose-600 dark:text-rose-400"
    : isWarning
    ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
    : "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400";

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-4 shadow-sm transition hover:shadow-md ${statusBg}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-xl ${
              isCritical
                ? "bg-rose-500 text-white"
                : isWarning
                ? "bg-amber-500 text-white"
                : "bg-slate-100 text-slate-700 dark:bg-[#22262f] dark:text-slate-300"
            }`}
          >
            <Icon className="h-4 w-4" />
          </div>

          <div>
            <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400">{title}</h4>
            {engineBadge && (
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                {engineBadge}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {trend !== undefined && (
            <span
              className={`flex items-center text-[11px] font-bold ${
                trend > 0 ? "text-rose-500" : "text-emerald-500"
              }`}
            >
              {trend > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {Math.abs(trend)}%
            </span>
          )}

          <span
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase ${badgeBg}`}
          >
            {isCritical ? (
              <>
                <AlertTriangle className="h-3 w-3" /> Critical
              </>
            ) : isWarning ? (
              <>
                <AlertTriangle className="h-3 w-3" /> Warning
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3 w-3" /> Optimal
              </>
            )}
          </span>
        </div>
      </div>

      <div className="mt-3 flex items-baseline gap-1.5">
        <span className={`text-2xl font-black tracking-tight ${statusText}`}>{value}</span>
        {unit && <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{unit}</span>}
      </div>

      {subtitle && <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{subtitle}</p>}

      {progressPct !== undefined && (
        <div className="mt-3">
          <div className="flex justify-between text-[10px] font-semibold text-slate-400 mb-1">
            <span>Capacity</span>
            <span>{progressPct.toFixed(1)}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                progressPct > 85 ? "bg-rose-500" : progressPct > 70 ? "bg-amber-500" : "bg-emerald-500"
              }`}
              style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
