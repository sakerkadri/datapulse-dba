import React from "react";
import {
  LayoutDashboard,
  Database,
  Bell,
  Terminal,
  Users,
  Mail,
  FileText,
  Sparkles,
  Layers,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { useDBA } from "../../context/DBAContext";

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab }) => {
  const { incidents, openAiDiagnosis } = useDBA();
  const firingCount = incidents.filter((i) => i.status === "FIRING").length;

  const navItems = [
    { id: "dashboard", label: "Monitoring Dashboard", icon: LayoutDashboard },
    { id: "databases", label: "Database Instances", icon: Database },
    {
      id: "alerts",
      label: "Thresholds & Incidents",
      icon: Bell,
      badge: firingCount > 0 ? firingCount : undefined,
    },
    { id: "logs", label: "Connection Logs", icon: Terminal },
    { id: "rbac", label: "Team & RBAC System", icon: Users },
    { id: "notifications", label: "Automated Email Alerts", icon: Mail },
    { id: "reports", label: "Exportable PDF Reports", icon: FileText },
  ];

  return (
    <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-slate-50/50 p-4 dark:border-[#272a30] dark:bg-[#15181e] lg:block">
      <div className="flex h-full flex-col justify-between">
        <div className="space-y-6">
          {/* Main Navigation links */}
          <div>
            <div className="px-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Core Platform
            </div>
            <nav className="mt-2 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className={`group flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-xs font-semibold transition cursor-pointer ${
                      isActive
                        ? "bg-indigo-500/10 text-indigo-600 dark:bg-indigo-600/20 dark:text-indigo-400 font-bold"
                        : "text-slate-600 hover:bg-slate-200/50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-[#1a1d23] dark:hover:text-slate-200"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className={`h-4 w-4 ${isActive ? "text-indigo-500" : "text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300"}`} />
                      <span>{item.label}</span>
                    </div>

                    {item.badge !== undefined && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white shadow-sm shadow-rose-500/30">
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* AI DBA Assistant card banner */}
          <div className="rounded-xl border border-indigo-200/40 bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-transparent p-3.5 dark:border-[#272a30] dark:bg-[#1a1d23]">
            <div className="flex items-center gap-2 font-bold text-xs text-indigo-600 dark:text-indigo-400">
              <Sparkles className="h-4 w-4 text-indigo-500" />
              <span>AI DBA Diagnostics</span>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-600 dark:text-slate-400 leading-snug">
              Instant root cause analysis, query plan optimization & index recommendations.
            </p>
            <button
              onClick={() =>
                openAiDiagnosis({
                  type: "slow_query",
                  query: "SELECT * FROM analytics_events WHERE created_at > NOW() - INTERVAL '1 hour';",
                  databaseType: "PostgreSQL",
                  metrics: { cpu: 96.4, latencyMs: 2450 },
                })
              }
              className="mt-3 w-full rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-[11px] font-semibold text-white transition cursor-pointer shadow-sm"
            >
              Analyze Slow Query
            </button>
          </div>
        </div>

        {/* Footer info & engine compatibility icons */}
        <div className="border-t border-slate-200 pt-4 dark:border-[#272a30] space-y-2">
          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>Supported Engines:</span>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
            <span className="rounded bg-slate-200/70 px-1.5 py-0.5 dark:bg-[#1a1d23] dark:border dark:border-[#272a30]">PostgreSQL</span>
            <span className="rounded bg-slate-200/70 px-1.5 py-0.5 dark:bg-[#1a1d23] dark:border dark:border-[#272a30]">SQL Server</span>
            <span className="rounded bg-slate-200/70 px-1.5 py-0.5 dark:bg-[#1a1d23] dark:border dark:border-[#272a30]">MySQL</span>
          </div>

          <div className="flex items-center gap-1.5 pt-2 text-[10px] text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            <span>SOC2 Type II & HIPAA Audit Compliant</span>
          </div>
        </div>
      </div>
    </aside>
  );
};
