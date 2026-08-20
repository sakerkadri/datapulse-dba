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
  Shield,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from "recharts";

export const DatabaseEngineMetrics: React.FC = () => {
  const { databases, openAiDiagnosis } = useDBA();
  const [activeEngineTab, setActiveEngineTab] = useState<"PostgreSQL" | "SQL Server" | "MySQL" | "Oracle">("PostgreSQL");

  const pgInstances = databases.filter((d) => d.engine === "PostgreSQL");
  const mssqlInstances = databases.filter((d) => d.engine === "SQL Server");
  const mysqlInstances = databases.filter((d) => d.engine === "MySQL");
  const oracleInstances = databases.filter((d) => d.engine === "Oracle");

  const [selectedOracleId, setSelectedOracleId] = useState<string>(
    oracleInstances[0]?.id || "db-ora-cdb01"
  );

  const selectedOracleDb =
    oracleInstances.find((d) => d.id === selectedOracleId) || oracleInstances[0];
  const oracleMetrics = selectedOracleDb?.engineSpecific?.oracle;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-[#272a30] dark:bg-[#1a1d23]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4 dark:border-[#272a30]">
        <div>
          <h3 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <Database className="h-4 w-4 text-indigo-500" />
            Engine-Specific Performance Diagnostics
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Tailored internal telemetry for PostgreSQL, SQL Server, MySQL, and Oracle CDB/PDB engines.
          </p>
        </div>

        {/* Engine Tabs */}
        <div className="flex flex-wrap rounded-xl bg-slate-100 p-1 dark:bg-[#15181e] gap-1">
          <button
            onClick={() => setActiveEngineTab("PostgreSQL")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
              activeEngineTab === "PostgreSQL"
                ? "bg-white text-indigo-600 shadow-sm dark:bg-[#1a1d23] dark:text-indigo-400"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <span>🐘 PostgreSQL</span>
            <span className="rounded bg-indigo-500/10 px-1.5 py-0.2 text-[10px] text-indigo-600 dark:text-indigo-400">
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
                ? "bg-white text-cyan-600 shadow-sm dark:bg-slate-700 dark:text-cyan-400"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <span>🐬 MySQL</span>
            <span className="rounded bg-cyan-500/10 px-1.5 py-0.2 text-[10px] text-cyan-600 dark:text-cyan-400">
              {mysqlInstances.length}
            </span>
          </button>

          <button
            onClick={() => setActiveEngineTab("Oracle")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
              activeEngineTab === "Oracle"
                ? "bg-white text-red-600 shadow-sm dark:bg-slate-700 dark:text-red-400"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <span>🏛️ Oracle</span>
            <span className="rounded bg-red-500/10 px-1.5 py-0.2 text-[10px] text-red-600 dark:text-red-400 font-black">
              {oracleInstances.length}
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
                <span className="text-xs font-semibold text-emerald-500">Normal</span>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">Archive rate: 80 MB / min</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
              <span className="text-[11px] font-bold text-slate-400 uppercase">Idle in Transaction</span>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-base font-black text-amber-500">2 Sessions</span>
                <button
                  onClick={() =>
                    openAiDiagnosis({
                      type: "slow_query",
                      query: "SELECT pid, usename, query, state, age(clock_timestamp(), query_start) FROM pg_stat_activity WHERE state = 'idle in transaction';",
                      databaseType: "PostgreSQL",
                    })
                  }
                  className="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400 cursor-pointer"
                >
                  AI Inspect
                </button>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">Holding row locks on orders table</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
              <span className="text-[11px] font-bold text-slate-400 uppercase">Buffer Cache Hit Ratio</span>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-base font-black text-emerald-600 dark:text-emerald-400">99.4%</span>
                <span className="text-xs font-semibold text-emerald-500">Optimal</span>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">RAM cache working effectively</p>
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

      {/* Content for Oracle */}
      {activeEngineTab === "Oracle" && selectedOracleDb && (
        <div className="mt-4 space-y-5">
          {/* 1. Instance Switcher & Header Bar */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-800/50">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-600/10 text-xl text-red-600 dark:bg-red-500/20 dark:text-red-400 font-bold shadow-inner">
                🏛️
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-extrabold text-slate-900 dark:text-white">
                    {selectedOracleDb.name}
                  </h4>
                  <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-extrabold text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                    {oracleMetrics?.isCdb
                      ? `CDB Multitenant (${oracleMetrics.pdbs?.length || 0} PDBs)`
                      : "Standalone Non-CDB"}
                  </span>
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-extrabold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                    {oracleMetrics?.archivelogMode || "ARCHIVELOG"}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                  {selectedOracleDb.version} • SID: {oracleMetrics?.instanceName || "ORCL"} • Host: {selectedOracleDb.host}:{selectedOracleDb.port}
                </p>
              </div>
            </div>

            {/* Switcher & AI Trigger */}
            <div className="flex items-center gap-2">
              {oracleInstances.length > 1 && (
                <select
                  value={selectedOracleDb.id}
                  onChange={(e) => setSelectedOracleId(e.target.value)}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 cursor-pointer"
                >
                  {oracleInstances.map((db) => (
                    <option key={db.id} value={db.id}>
                      {db.name} ({db.engineSpecific?.oracle?.isCdb ? "CDB" : "Standalone"})
                    </option>
                  ))}
                </select>
              )}

              <button
                onClick={() =>
                  openAiDiagnosis({
                    type: "slow_query",
                    databaseType: "Oracle",
                    query: `SELECT instance_name, host_name, version, status, archiver, database_status FROM v$instance;`,
                    metrics: {
                      sgaTotalMb: oracleMetrics?.sga.totalSgaMb,
                      bufferCacheHitRatio: oracleMetrics?.sga.bufferCacheHitRatio,
                      redoSwitchesPerHour: oracleMetrics?.redoLogs.currentSwitchRatePerHour,
                      dataGuardApplyLag: oracleMetrics?.dataGuard.applyLagSeconds,
                      pdbsCount: oracleMetrics?.pdbs?.length || 0,
                    },
                  })
                }
                className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-purple-700 transition cursor-pointer shadow-sm"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Oracle AI Health Check</span>
              </button>
            </div>
          </div>

          {/* 2. Background Processes Health Matrix */}
          {oracleMetrics?.backgroundProcesses && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-[#1a1d23]">
              <span className="text-[11px] font-bold text-slate-400 uppercase flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-indigo-500" /> Background Processes:
              </span>
              <div className="flex flex-wrap gap-2">
                {Object.entries(oracleMetrics.backgroundProcesses).map(([proc, status]) => {
                  const isRunning = status === "RUNNING";
                  return (
                    <span
                      key={proc}
                      className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-mono font-bold uppercase ${
                        isRunning
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                          : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 animate-pulse"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${isRunning ? "bg-emerald-500" : "bg-rose-500"}`} />
                      {proc.toUpperCase()}: {status}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* 3. Data Guard Replication & Standby Status Banner */}
          {oracleMetrics?.dataGuard && oracleMetrics.dataGuard.enabled && (
            <div
              className={`flex flex-col sm:flex-row sm:items-center sm:justify-between rounded-xl border p-3.5 transition ${
                oracleMetrics.dataGuard.status === "SYNCHRONIZED"
                  ? "border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-950/20"
                  : "border-rose-500/40 bg-rose-500/10 dark:bg-rose-950/30"
              }`}
            >
              <div className="flex items-center gap-3">
                <Shield
                  className={`h-5 w-5 ${
                    oracleMetrics.dataGuard.status === "SYNCHRONIZED" ? "text-emerald-500" : "text-rose-500"
                  }`}
                />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900 dark:text-white">
                      Oracle Data Guard ({oracleMetrics.dataGuard.dbRole})
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.2 text-[9px] font-black uppercase ${
                        oracleMetrics.dataGuard.status === "SYNCHRONIZED"
                          ? "bg-emerald-500 text-white"
                          : "bg-rose-500 text-white"
                      }`}
                    >
                      {oracleMetrics.dataGuard.status}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      Mode: {oracleMetrics.dataGuard.protectionMode}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Transport Status:{" "}
                    <strong className="text-slate-700 dark:text-slate-200">
                      {oracleMetrics.dataGuard.redoTransportStatus}
                    </strong>{" "}
                    • Standby Apply Rate:{" "}
                    <strong className="text-slate-700 dark:text-slate-200">
                      {(oracleMetrics.dataGuard.standbyApplyRateKbSec / 1024).toFixed(1)} MB/s
                    </strong>
                  </p>
                </div>
              </div>

              <div className="mt-2 sm:mt-0 flex items-center gap-4 text-xs font-mono">
                <div>
                  <span className="text-slate-400 text-[10px]">Transport Lag:</span>
                  <p className="font-bold text-slate-800 dark:text-slate-200">
                    +{oracleMetrics.dataGuard.transportLagSeconds}s
                  </p>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px]">Apply Lag:</span>
                  <p
                    className={`font-bold ${
                      oracleMetrics.dataGuard.applyLagSeconds > 60
                        ? "text-rose-500 font-black"
                        : "text-emerald-500"
                    }`}
                  >
                    +{oracleMetrics.dataGuard.applyLagSeconds}s
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 4. Multitenant CDB / PDB Explorer */}
          {oracleMetrics?.isCdb && oracleMetrics.pdbs && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-4 dark:border-slate-800 dark:bg-slate-800/30">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-3 border-b border-slate-200/60 dark:border-slate-700/60 gap-2">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-indigo-500" />
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                    Multitenant Pluggable Database (PDB) Explorer
                  </h4>
                </div>
                <span className="text-[11px] text-slate-500 font-mono">
                  {oracleMetrics.pdbs.length} Containers Active
                </span>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {oracleMetrics.pdbs.map((pdb) => {
                  const isHighCpu = pdb.cpuSlicePct > 50;
                  const isLowHeadroom = pdb.autoextendHeadroomGb < 50;

                  return (
                    <div
                      key={pdb.conId}
                      className={`rounded-xl border p-3.5 transition flex flex-col justify-between ${
                        isHighCpu
                          ? "border-amber-500/40 bg-amber-500/5 dark:bg-amber-950/20"
                          : "border-slate-200 bg-white dark:border-slate-800 dark:bg-[#1a1d23]"
                      }`}
                    >
                      <div>
                        <div className="flex items-start justify-between">
                          <div>
                            <span className="text-[10px] font-mono text-slate-400">
                              CON_ID: {pdb.conId}
                            </span>
                            <h5 className="text-sm font-extrabold text-slate-900 dark:text-white">
                              {pdb.pdbName}
                            </h5>
                          </div>
                          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-600 dark:text-emerald-400">
                            {pdb.openMode}
                          </span>
                        </div>

                        {/* CPU Slice Meter */}
                        <div className="mt-3">
                          <div className="flex justify-between text-[11px]">
                            <span className="text-slate-400">CPU Slice:</span>
                            <span
                              className={`font-bold font-mono ${
                                isHighCpu ? "text-amber-500" : "text-slate-700 dark:text-slate-200"
                              }`}
                            >
                              {pdb.cpuSlicePct}%
                            </span>
                          </div>
                          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                            <div
                              className={`h-full rounded-full ${
                                isHighCpu ? "bg-amber-500" : "bg-indigo-500"
                              }`}
                              style={{ width: `${Math.min(100, pdb.cpuSlicePct)}%` }}
                            />
                          </div>
                        </div>

                        {/* Sessions & Storage Grid */}
                        <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] font-mono text-slate-500 dark:text-slate-400">
                          <div>
                            <span>Active Sessions:</span>
                            <p className="font-bold text-slate-800 dark:text-slate-200">
                              {pdb.activeSessions} / {pdb.totalSessions}
                            </p>
                          </div>
                          <div>
                            <span>Used Space:</span>
                            <p className="font-bold text-slate-800 dark:text-slate-200">
                              {pdb.usedSizeGb} GB
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Autoextend Headroom Footer */}
                      <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[10px]">
                        <span className="text-slate-400">Headroom:</span>
                        <span
                          className={`font-bold font-mono ${
                            isLowHeadroom ? "text-rose-500" : "text-emerald-500"
                          }`}
                        >
                          {pdb.autoextendHeadroomGb} GB free
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 5. Memory Architecture: SGA vs PGA Visualizer */}
          {oracleMetrics && (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* System Global Area (SGA) Card */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#1a1d23]">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Cpu className="h-4 w-4 text-emerald-500" />
                    SGA Memory Allocation ({(oracleMetrics.sga.totalSgaMb / 1024).toFixed(1)} GB)
                  </span>
                  <span
                    className={`text-xs font-bold font-mono ${
                      oracleMetrics.sga.bufferCacheHitRatio >= 90
                        ? "text-emerald-500"
                        : oracleMetrics.sga.bufferCacheHitRatio >= 80
                        ? "text-amber-500"
                        : "text-rose-500"
                    }`}
                  >
                    Hit Ratio: {oracleMetrics.sga.bufferCacheHitRatio}%
                  </span>
                </div>

                {/* SGA Dynamic Components Stacked Visual Bar */}
                <div className="mt-3">
                  <div className="h-3 w-full overflow-hidden rounded-full flex bg-slate-100 dark:bg-slate-800">
                    <div
                      style={{
                        width: `${(oracleMetrics.sga.bufferCacheMb / oracleMetrics.sga.totalSgaMb) * 100}%`,
                      }}
                      className="bg-emerald-500 h-full"
                      title={`Buffer Cache: ${(oracleMetrics.sga.bufferCacheMb / 1024).toFixed(1)} GB`}
                    />
                    <div
                      style={{
                        width: `${(oracleMetrics.sga.sharedPoolMb / oracleMetrics.sga.totalSgaMb) * 100}%`,
                      }}
                      className="bg-indigo-500 h-full"
                      title={`Shared Pool: ${(oracleMetrics.sga.sharedPoolMb / 1024).toFixed(1)} GB`}
                    />
                    <div
                      style={{
                        width: `${(oracleMetrics.sga.largePoolMb / oracleMetrics.sga.totalSgaMb) * 100}%`,
                      }}
                      className="bg-purple-500 h-full"
                      title={`Large Pool: ${(oracleMetrics.sga.largePoolMb / 1024).toFixed(1)} GB`}
                    />
                    <div
                      style={{
                        width: `${(oracleMetrics.sga.freeSgaMb / oracleMetrics.sga.totalSgaMb) * 100}%`,
                      }}
                      className="bg-slate-400 h-full"
                      title={`Free SGA: ${(oracleMetrics.sga.freeSgaMb / 1024).toFixed(1)} GB`}
                    />
                  </div>

                  {/* SGA Legend Grid */}
                  <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] font-mono">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      <span className="text-slate-500">Buffer Cache:</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        {(oracleMetrics.sga.bufferCacheMb / 1024).toFixed(1)}G
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-indigo-500" />
                      <span className="text-slate-500">Shared Pool:</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        {(oracleMetrics.sga.sharedPoolMb / 1024).toFixed(1)}G
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-purple-500" />
                      <span className="text-slate-500">Large Pool:</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        {(oracleMetrics.sga.largePoolMb / 1024).toFixed(1)}G
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Program Global Area (PGA) Card */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#1a1d23]">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Cpu className="h-4 w-4 text-indigo-500" />
                    PGA Memory ({(oracleMetrics.pga.pgaTargetMb / 1024).toFixed(1)} GB Target)
                  </span>
                  <span className="text-xs font-bold font-mono text-emerald-500">
                    PGA Cache Hit: {oracleMetrics.pga.pgaCacheHitRatio}%
                  </span>
                </div>

                <div className="mt-3 space-y-2 text-xs font-mono">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Allocated PGA:</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      {(oracleMetrics.pga.pgaAllocatedMb / 1024).toFixed(2)} GB
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">In-Use Active:</span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                      {(oracleMetrics.pga.pgaInUseMb / 1024).toFixed(2)} GB
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Freeable Headroom:</span>
                    <span className="font-bold text-indigo-500">
                      {(oracleMetrics.pga.pgaFreeableMb / 1024).toFixed(2)} GB
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 6. Redo Log Switch Frequency Chart */}
          {oracleMetrics?.redoLogs && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#1a1d23]">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-3 border-b border-slate-100 dark:border-slate-800 gap-2">
                <div>
                  <h4 className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <RotateCw className="h-4 w-4 text-emerald-500" />
                    Redo Log Switch Frequency (Last 24 Hours)
                  </h4>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Hourly checkpoint switches (Spikes &gt; 6/hr highlighted in red)
                  </p>
                </div>

                <div className="flex items-center gap-3 text-xs font-mono">
                  <div>
                    <span className="text-slate-400 text-[10px]">Current Rate:</span>
                    <p
                      className={`font-black ${
                        oracleMetrics.redoLogs.currentSwitchRatePerHour > 6
                          ? "text-rose-500"
                          : "text-emerald-500"
                      }`}
                    >
                      {oracleMetrics.redoLogs.currentSwitchRatePerHour} / hr
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px]">LGWR Latency:</span>
                    <p className="font-bold text-slate-800 dark:text-slate-200">
                      {oracleMetrics.redoLogs.lgwrLatencyMs} ms
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-4 h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={oracleMetrics.redoLogs.last24HoursHistory}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                    <XAxis dataKey="hour" stroke="#94a3b8" fontSize={9} />
                    <YAxis stroke="#94a3b8" fontSize={9} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#0f172a",
                        borderColor: "#334155",
                        borderRadius: "12px",
                        color: "#f8fafc",
                        fontSize: "11px",
                      }}
                    />
                    <Bar
                      dataKey="switchCount"
                      name="Log Switches"
                      isAnimationActive={false}
                      radius={[4, 4, 0, 0]}
                    >
                      {oracleMetrics.redoLogs.last24HoursHistory.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={entry.switchCount > 6 ? "#f43f5e" : "#6366f1"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* 7. ASM Diskgroup Grid */}
          {oracleMetrics?.asmDiskgroups && oracleMetrics.asmDiskgroups.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#1a1d23]">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <h4 className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <HardDrive className="h-4 w-4 text-indigo-500" />
                  ASM (Automatic Storage Management) Diskgroups
                </h4>
                <span className="text-[10px] text-slate-500 font-mono">
                  {oracleMetrics.asmDiskgroups.length} Groups Mounted
                </span>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {oracleMetrics.asmDiskgroups.map((dg) => {
                  const isHighUsage = dg.usedPct > 85;

                  return (
                    <div
                      key={dg.name}
                      className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 dark:border-slate-800 dark:bg-slate-800/40"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-black text-slate-900 dark:text-white">
                          {dg.name}
                        </span>
                        <span className="rounded bg-indigo-500/10 px-1.5 py-0.2 text-[9px] font-bold text-indigo-600 dark:text-indigo-400">
                          {dg.type} Redundancy
                        </span>
                      </div>

                      {/* Capacity Progress Bar */}
                      <div className="mt-2.5">
                        <div className="flex justify-between text-[10px] font-mono">
                          <span className="text-slate-400">Capacity:</span>
                          <span
                            className={`font-bold ${
                              isHighUsage ? "text-rose-500" : "text-slate-700 dark:text-slate-300"
                            }`}
                          >
                            {(dg.totalMb - dg.freeMb) / 1024 >= 1
                              ? `${((dg.totalMb - dg.freeMb) / 1024 / 1024).toFixed(2)} TB`
                              : `${((dg.totalMb - dg.freeMb) / 1024).toFixed(0)} GB`}{" "}
                            / {(dg.totalMb / 1024 / 1024).toFixed(2)} TB ({dg.usedPct}%)
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                          <div
                            className={`h-full rounded-full ${
                              isHighUsage ? "bg-rose-500" : "bg-emerald-500"
                            }`}
                            style={{ width: `${dg.usedPct}%` }}
                          />
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-between text-[10px] font-mono text-slate-500">
                        <span>
                          Usable Free:{" "}
                          <strong className="text-slate-700 dark:text-slate-300">
                            {(dg.usableFileMb / 1024 / 1024).toFixed(2)} TB
                          </strong>
                        </span>
                        <span
                          className={
                            dg.offlineDisks > 0 ? "text-rose-500 font-bold" : "text-emerald-500"
                          }
                        >
                          {dg.offlineDisks} Offline / {dg.totalDisks} Disks
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 8. Top Wait Classes & Active Session Wait Events */}
          {oracleMetrics?.topWaitEvents && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-4 dark:border-slate-800 dark:bg-slate-800/30">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-indigo-500" />
                  Top Active Wait Events (V$SYSTEM_EVENT & Active Session History)
                </span>
              </div>

              <div className="overflow-x-auto text-[11px] font-mono text-slate-600 dark:text-slate-300">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-400">
                      <th className="py-1.5">Wait Event</th>
                      <th className="py-1.5">Wait Class</th>
                      <th className="py-1.5">Total Waits</th>
                      <th className="py-1.5">Time Waited</th>
                      <th className="py-1.5">Avg Wait</th>
                      <th className="py-1.5">% DB Time</th>
                      <th className="py-1.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/50 dark:divide-slate-800">
                    {oracleMetrics.topWaitEvents.map((evt) => (
                      <tr key={evt.event}>
                        <td className="py-1.5 font-bold text-slate-900 dark:text-white">
                          {evt.event}
                        </td>
                        <td className="py-1.5">
                          <span className="rounded bg-slate-100 px-1.5 py-0.2 text-[9px] dark:bg-slate-800">
                            {evt.waitClass}
                          </span>
                        </td>
                        <td className="py-1.5">{evt.totalWaits.toLocaleString()}</td>
                        <td className="py-1.5 font-bold text-indigo-500">{evt.timeWaitedSec}s</td>
                        <td className="py-1.5">{evt.avgWaitMs}ms</td>
                        <td className="py-1.5 font-bold text-emerald-500">{evt.pctDbTime}%</td>
                        <td className="py-1.5 text-right">
                          <button
                            onClick={() =>
                              openAiDiagnosis({
                                type: "slow_query",
                                databaseType: "Oracle",
                                query: `-- Diagnosing Oracle Wait Event: ${evt.event} (${evt.waitClass})\nSELECT sid, event, wait_class, seconds_in_wait, sql_id FROM v$session WHERE event = '${evt.event}';`,
                                metrics: evt,
                              })
                            }
                            className="text-[10px] font-bold text-purple-600 dark:text-purple-400 hover:underline cursor-pointer"
                          >
                            AI Diagnose
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
