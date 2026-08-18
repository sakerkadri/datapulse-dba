import React, { useState } from "react";
import { useDBA } from "../../context/DBAContext";
import {
  Database,
  Activity,
  Layers,
  Cpu,
  Lock,
  RotateCw,
  HardDrive,
  Clock,
  Sparkles,
  Zap,
} from "lucide-react";

export const DatabaseEngineMetrics: React.FC = () => {
  const { databases, openAiDiagnosis } = useDBA();
  const [activeEngineTab, setActiveEngineTab] = useState<"PostgreSQL" | "SQL Server" | "MySQL">("PostgreSQL");

  const pgInstances = databases.filter((d) => d.engine === "PostgreSQL");
  const mssqlInstances = databases.filter((d) => d.engine === "SQL Server");
  const mysqlInstances = databases.filter((d) => d.engine === "MySQL");

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-[#272a30] dark:bg-[#1a1d23]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4 dark:border-[#272a30]">
        <div>
          <h3 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <Database className="h-4 w-4 text-indigo-500" />
            Engine-Specific Performance Diagnostics
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Tailored internal telemetry for PostgreSQL, SQL Server, and MySQL storage engines.
          </p>
        </div>

        {/* Engine Tabs */}
        <div className="flex rounded-xl bg-slate-100 p-1 dark:bg-[#15181e]">
          <button
            onClick={() => setActiveEngineTab("PostgreSQL")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
              activeEngineTab === "PostgreSQL"
                ? "bg-white text-indigo-600 shadow-sm dark:bg-[#1a1d23] dark:text-indigo-400"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <span>🐘 PostgreSQL</span>
            <span className="rounded bg-emerald-500/10 px-1.5 py-0.2 text-[10px] text-emerald-600 dark:text-emerald-400">
              {pgInstances.length}
            </span>
          </button>

          <button
            onClick={() => setActiveEngineTab("SQL Server")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
              activeEngineTab === "SQL Server"
                ? "bg-white text-emerald-600 shadow-sm dark:bg-slate-700 dark:text-emerald-400"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <span>⚡ SQL Server</span>
            <span className="rounded bg-emerald-500/10 px-1.5 py-0.2 text-[10px] text-emerald-600 dark:text-emerald-400">
              {mssqlInstances.length}
            </span>
          </button>

          <button
            onClick={() => setActiveEngineTab("MySQL")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
              activeEngineTab === "MySQL"
                ? "bg-white text-emerald-600 shadow-sm dark:bg-slate-700 dark:text-emerald-400"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <span>🐬 MySQL</span>
            <span className="rounded bg-emerald-500/10 px-1.5 py-0.2 text-[10px] text-emerald-600 dark:text-emerald-400">
              {mysqlInstances.length}
            </span>
          </button>
        </div>
      </div>

      {/* Content for PostgreSQL */}
      {activeEngineTab === "PostgreSQL" && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
              <span className="text-[11px] font-bold text-slate-400 uppercase">Autovacuum Status</span>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-base font-black text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                  <RotateCw className="h-4 w-4 animate-spin text-emerald-500" /> Active
                </span>
                <span className="text-xs font-semibold text-slate-500">2 Workers</span>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">Cleaning dead tuples in customer_orders_db</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
              <span className="text-[11px] font-bold text-slate-400 uppercase">WAL Log Generation</span>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-base font-black text-slate-900 dark:text-white">1,280 MB</span>
                <span className="text-xs font-semibold text-amber-500">+14 MB/s</span>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">WAL archival sync lag: 0.2s</p>
            </div>

            <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3.5 dark:border-rose-900/40 dark:bg-rose-950/20">
              <span className="text-[11px] font-bold text-rose-500 uppercase">Idle in Transaction</span>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-base font-black text-rose-600 dark:text-rose-400">14 Sessions</span>
                <button
                  onClick={() =>
                    openAiDiagnosis({
                      type: "slow_query",
                      query: "SELECT pid, age(clock_timestamp(), query_start), usename, query FROM pg_stat_activity WHERE state = 'idle in transaction';",
                      databaseType: "PostgreSQL",
                    })
                  }
                  className="rounded bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-rose-700 cursor-pointer"
                >
                  Inspect
                </button>
              </div>
              <p className="mt-1 text-[10px] text-rose-600/80 dark:text-rose-400/80">
                Risk of table bloat and lock holding
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
              <span className="text-[11px] font-bold text-slate-400 uppercase">Cache Buffer Hit</span>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-base font-black text-emerald-600 dark:text-emerald-400">99.4%</span>
                <span className="text-xs font-semibold text-slate-500">shared_buffers</span>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">High shared memory hit ratio</p>
            </div>
          </div>

          {/* Postgres Query Activity Snapshot */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-3 dark:border-slate-800 dark:bg-slate-800/30">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-emerald-500" />
                pg_stat_activity Top Active Transactions
              </span>
              <button
                onClick={() =>
                  openAiDiagnosis({
                    type: "slow_query",
                    query: "SELECT pid, age(clock_timestamp(), query_start), usename, query FROM pg_stat_activity WHERE state != 'idle' ORDER BY age(clock_timestamp(), query_start) DESC LIMIT 5;",
                    databaseType: "PostgreSQL",
                  })
                }
                className="text-[11px] font-semibold text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Sparkles className="h-3 w-3" /> AI Query Tuning
              </button>
            </div>

            <div className="overflow-x-auto text-[11px] font-mono text-slate-600 dark:text-slate-300">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-400">
                    <th className="py-1">PID</th>
                    <th className="py-1">User</th>
                    <th className="py-1">Duration</th>
                    <th className="py-1">State</th>
                    <th className="py-1">Query</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/50 dark:divide-slate-800">
                  <tr>
                    <td className="py-1 font-bold text-emerald-600 dark:text-emerald-400">94821</td>
                    <td className="py-1">bi_etl_worker</td>
                    <td className="py-1 text-rose-500 font-bold">14.2s</td>
                    <td className="py-1">active</td>
                    <td className="py-1 truncate max-w-xs text-slate-800 dark:text-slate-200">
                      SELECT * FROM analytics_events WHERE created_at &gt; NOW() - INTERVAL &apos;1 day&apos;
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1">94804</td>
                    <td className="py-1">app_orders_rw</td>
                    <td className="py-1">0.12s</td>
                    <td className="py-1">active</td>
                    <td className="py-1 truncate max-w-xs">
                      UPDATE orders SET status = &apos;PAID&apos; WHERE id = &apos;ord_99018&apos;
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Content for SQL Server */}
      {activeEngineTab === "SQL Server" && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3.5 dark:border-amber-900/40 dark:bg-amber-950/20">
              <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 uppercase">TempDB Contention</span>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-base font-black text-amber-600 dark:text-amber-400">24.8%</span>
                <span className="text-xs font-semibold text-amber-600">PAGELATCH_UP</span>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">Allocation bottleneck on GAM / PFS pages</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
              <span className="text-[11px] font-bold text-slate-400 uppercase">Page Life Expectancy</span>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-base font-black text-slate-900 dark:text-white">1,450s</span>
                <span className="text-xs font-semibold text-emerald-500">&gt; 300s SLA</span>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">Buffer pool page retention healthy</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
              <span className="text-[11px] font-bold text-slate-400 uppercase">Batch Requests / sec</span>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-base font-black text-slate-900 dark:text-white">12,800</span>
                <span className="text-xs font-semibold text-slate-500">req/s</span>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">Throughput peak during business hours</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
              <span className="text-[11px] font-bold text-slate-400 uppercase">Deadlocks Detected</span>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-base font-black text-rose-500">4 Graphs</span>
                <button
                  onClick={() =>
                    openAiDiagnosis({
                      type: "slow_query",
                      query: "EXEC sp_readerrorlog 0, 1, 'deadlock';",
                      databaseType: "SQL Server",
                    })
                  }
                  className="rounded bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  XML Graph
                </button>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">Key lock cyclic dependency killed by SPID 82</p>
            </div>
          </div>
        </div>
      )}

      {/* Content for MySQL */}
      {activeEngineTab === "MySQL" && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
              <span className="text-[11px] font-bold text-slate-400 uppercase">InnoDB Buffer Pool Hit</span>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-base font-black text-emerald-600 dark:text-emerald-400">98.9%</span>
                <span className="text-xs font-semibold text-slate-500">Read Hit</span>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">4,096 / 4,194 pages dirty: 0.1%</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
              <span className="text-[11px] font-bold text-slate-400 uppercase">Threads Connected</span>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-base font-black text-slate-900 dark:text-white">92 / 250</span>
                <span className="text-xs font-semibold text-emerald-500">36.8%</span>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">Threads running: 4</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
              <span className="text-[11px] font-bold text-slate-400 uppercase">Slow Query Log</span>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-base font-black text-slate-900 dark:text-white">1 query</span>
                <span className="text-xs font-semibold text-slate-500">&gt; 2.0s</span>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">log_queries_not_using_indexes = ON</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
              <span className="text-[11px] font-bold text-slate-400 uppercase">Table Lock Waits</span>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-base font-black text-emerald-600 dark:text-emerald-400">0 Waits</span>
                <span className="text-xs font-semibold text-slate-500">InnoDB Row Lock</span>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">No metadata lock blocking</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
