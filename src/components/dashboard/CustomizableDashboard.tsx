import React, { useState } from "react";
import { useDBA } from "../../context/DBAContext";
import { MetricCard } from "./MetricCard";
import { DatabaseEngineMetrics } from "./DatabaseEngineMetrics";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  BarChart,
  Bar,
} from "recharts";
import {
  Cpu,
  HardDrive,
  Activity,
  Users,
  Clock,
  AlertTriangle,
  Sliders,
  CheckCircle2,
  Terminal,
  Sparkles,
  Zap,
  Shield,
  RefreshCw,
  X,
  Plus,
} from "lucide-react";

export const CustomizableDashboard: React.FC = () => {
  const {
    databases,
    selectedDbId,
    metricsHistory,
    incidents,
    logs,
    activePreset,
    setActivePreset,
    presetList,
    timeRange,
    setTimeRange,
    openAiDiagnosis,
    acknowledgeIncident,
    triggerRemediation,
  } = useDBA();

  const [customizeOpen, setCustomizeOpen] = useState<boolean>(false);
  const [widgetsState, setWidgetsState] = useState(activePreset.widgets);

  // Filter databases if specific database is selected
  const activeDatabases =
    selectedDbId === "ALL"
      ? databases
      : databases.filter((d) => d.id === selectedDbId);

  // Calculate fleet aggregations
  const totalConns = activeDatabases.reduce((acc, d) => acc + d.activeConnections, 0);
  const maxConns = activeDatabases.reduce((acc, d) => acc + d.maxConnections, 0);
  const avgCpu = Number(
    (activeDatabases.reduce((acc, d) => acc + d.cpuUsage, 0) / (activeDatabases.length || 1)).toFixed(1)
  );
  const avgLatency = Number(
    (activeDatabases.reduce((acc, d) => acc + d.queryLatencyMs, 0) / (activeDatabases.length || 1)).toFixed(1)
  );

  const firingIncidents = incidents.filter((i) => i.status === "FIRING");

  const toggleWidget = (id: string) => {
    setWidgetsState((prev) =>
      prev.map((w) => (w.id === id ? { ...w, visible: !w.visible } : w))
    );
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Controls Bar: Presets, Time Range, Customize Layout */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-[#272a30] dark:bg-[#1a1d23]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-indigo-500" />
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Layout Preset:</span>
          </div>

          <select
            value={activePreset.id}
            onChange={(e) => {
              const found = presetList.find((p) => p.id === e.target.value);
              if (found) {
                setActivePreset(found);
                setWidgetsState(found.widgets);
              }
            }}
            className="h-9 cursor-pointer rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-extrabold text-slate-800 transition dark:border-[#272a30] dark:bg-[#22262f] dark:text-slate-200 focus:outline-none"
          >
            {presetList.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <span className="hidden text-xs text-slate-400 lg:inline">
            {activePreset.description}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Time Range Selector */}
          <div className="flex rounded-xl bg-slate-100 p-1 dark:bg-[#15181e]">
            {["5m", "15m", "1h", "6h", "24h", "7d"].map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition cursor-pointer ${
                  timeRange === range
                    ? "bg-white text-indigo-600 shadow-sm dark:bg-[#1a1d23] dark:text-indigo-400"
                    : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                {range}
              </button>
            ))}
          </div>

          {/* Customize Widgets Button */}
          <button
            onClick={() => setCustomizeOpen(!customizeOpen)}
            className="flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-[#272a30] dark:bg-[#1a1d23] dark:text-slate-300 dark:hover:bg-[#22262f] cursor-pointer"
          >
            <Sliders className="h-3.5 w-3.5" />
            <span>Customize</span>
          </button>
        </div>
      </div>

      {/* Customize Drawer Modal */}
      {customizeOpen && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 dark:bg-emerald-950/20">
          <div className="flex items-center justify-between border-b border-emerald-500/20 pb-3">
            <h4 className="text-xs font-extrabold text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
              <Sliders className="h-4 w-4" /> Toggle Dashboard Widgets Visibility
            </h4>
            <button
              onClick={() => setCustomizeOpen(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2 md:grid-cols-3">
            {widgetsState.map((w) => (
              <label
                key={w.id}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-2.5 text-xs font-semibold text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 cursor-pointer"
              >
                <span>{w.title}</span>
                <input
                  type="checkbox"
                  checked={w.visible}
                  onChange={() => toggleWidget(w.id)}
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Critical Firing Incident Alert Banner */}
      {widgetsState.find((w) => w.type === "INCIDENT_BANNER")?.visible &&
        firingIncidents.length > 0 && (
          <div className="space-y-3">
            {firingIncidents.map((inc) => (
              <div
                key={inc.id}
                className="flex flex-col gap-3 rounded-2xl border border-rose-500/40 bg-gradient-to-r from-rose-500/10 via-rose-500/5 to-transparent p-4 dark:bg-rose-950/30 sm:flex-row sm:items-center sm:justify-between shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500 text-white shadow-md shadow-rose-500/20 animate-pulse">
                    <AlertTriangle className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-rose-500 px-2 py-0.5 text-[10px] font-black uppercase text-white">
                        {inc.severity}
                      </span>
                      <span className="text-xs font-bold text-slate-900 dark:text-white">
                        {inc.databaseName} ({inc.engine})
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        ID: {inc.id}
                      </span>
                    </div>

                    <h4 className="mt-1 text-sm font-extrabold text-rose-700 dark:text-rose-300">
                      {inc.title}
                    </h4>

                    <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                      Current: <strong className="text-rose-600">{inc.currentValue}{inc.unit}</strong> (Threshold: {inc.thresholdValue}{inc.unit})
                      {inc.notes && <span className="ml-2 italic text-slate-500">"{inc.notes}"</span>}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() =>
                      openAiDiagnosis({
                        type: "incident",
                        databaseType: inc.engine,
                        incidentContext: `${inc.title}: current ${inc.currentValue}${inc.unit}, threshold ${inc.thresholdValue}${inc.unit}`,
                        metrics: { currentValue: inc.currentValue },
                      })
                    }
                    className="flex items-center gap-1.5 rounded-xl bg-purple-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-purple-700 transition cursor-pointer shadow-sm"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>AI Diagnosis</span>
                  </button>

                  {inc.remediationScript && (
                    <button
                      onClick={() => triggerRemediation(inc.id)}
                      className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 transition cursor-pointer"
                    >
                      <Zap className="h-3.5 w-3.5 text-amber-400" />
                      <span>Run Remediation</span>
                    </button>
                  )}

                  <button
                    onClick={() => acknowledgeIncident(inc.id, "Acknowledged via Dashboard War Room")}
                    className="rounded-xl border border-rose-300 bg-white px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-rose-950 transition cursor-pointer"
                  >
                    Acknowledge
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

      {/* Fleet Top Summary Cards */}
      {widgetsState.find((w) => w.type === "METRIC_GAUGE")?.visible && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Avg Fleet CPU Load"
            value={`${avgCpu}%`}
            unit="Utilization"
            subtitle="Across active database cluster nodes"
            trend={avgCpu > 80 ? 12.4 : -2.1}
            status={avgCpu > 85 ? "CRITICAL" : avgCpu > 75 ? "WARNING" : "NORMAL"}
            icon={Cpu}
            progressPct={avgCpu}
          />

          <MetricCard
            title="Query Latency (Mean)"
            value={`${avgLatency}`}
            unit="ms"
            subtitle="P95 execution response SLA"
            trend={avgLatency > 100 ? 28.5 : -4.0}
            status={avgLatency > 1000 ? "CRITICAL" : avgLatency > 200 ? "WARNING" : "NORMAL"}
            icon={Clock}
          />

          <MetricCard
            title="Active Connections Pool"
            value={`${totalConns} / ${maxConns}`}
            unit="Connections"
            subtitle="Client session pool saturation"
            status={(totalConns / maxConns) > 0.9 ? "CRITICAL" : (totalConns / maxConns) > 0.75 ? "WARNING" : "NORMAL"}
            icon={Users}
            progressPct={(totalConns / maxConns) * 100}
          />

          <MetricCard
            title="Database Fleet Uptime"
            value="99.99%"
            unit="Availability"
            subtitle="SOC2 high availability standard"
            status="NORMAL"
            icon={Shield}
          />
        </div>
      )}

      {/* Real-time Metric Charts Section */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Real-Time Query Latency & IOPS Area Chart */}
        {widgetsState.find((w) => w.type === "LATENCY_CHART")?.visible && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-[#272a30] dark:bg-[#1a1d23]">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                  <Activity className="h-4 w-4 text-emerald-500" />
                  Real-time Query Latency & IOPS Telemetry
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Live response time (ms) and Disk I/O operations per second
                </p>
              </div>

              <button
                onClick={() =>
                  openAiDiagnosis({
                    type: "slow_query",
                    query: "SELECT name, query_latency_ms, iops FROM db_instances ORDER BY query_latency_ms DESC;",
                    metrics: metricsHistory[metricsHistory.length - 1],
                  })
                }
                className="flex items-center gap-1 rounded-lg bg-purple-500/10 px-2.5 py-1 text-xs font-bold text-purple-600 dark:bg-purple-500/20 dark:text-purple-300 hover:bg-purple-500/20 cursor-pointer"
              >
                <Sparkles className="h-3 w-3" /> AI Analysis
              </button>
            </div>

            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={metricsHistory}>
                  <defs>
                    <linearGradient id="latencyGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="iopsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                  <XAxis dataKey="timestamp" stroke="#94a3b8" fontSize={10} />
                  <YAxis stroke="#94a3b8" fontSize={10} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0f172a",
                      borderColor: "#334155",
                      borderRadius: "12px",
                      color: "#f8fafc",
                      fontSize: "12px",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="latencyMs"
                    name="Latency (ms)"
                    stroke="#10b981"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#latencyGrad)"
                  />
                  <Area
                    type="monotone"
                    dataKey="cpu"
                    name="CPU %"
                    stroke="#6366f1"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#iopsGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Active Connections & Slow Queries Chart */}
        {widgetsState.find((w) => w.type === "CONNECTIONS_CHART")?.visible && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-[#272a30] dark:bg-[#1a1d23]">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                  <Users className="h-4 w-4 text-indigo-500" />
                  Active Connections & Slow Query Frequency
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Client session pool usage vs slow queries (&gt; 2000ms)
                </p>
              </div>

              <span className="rounded-md bg-indigo-500/10 px-2 py-0.5 text-xs font-bold text-indigo-600 dark:text-indigo-400">
                {totalConns} Active Sessions
              </span>
            </div>

            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metricsHistory}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                  <XAxis dataKey="timestamp" stroke="#94a3b8" fontSize={10} />
                  <YAxis stroke="#94a3b8" fontSize={10} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0f172a",
                      borderColor: "#334155",
                      borderRadius: "12px",
                      color: "#f8fafc",
                      fontSize: "12px",
                    }}
                  />
                  <Bar dataKey="activeConn" name="Active Conns" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="slowQueries" name="Slow Queries" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Engine Specific Diagnostics Component */}
      {widgetsState.find((w) => w.type === "ENGINE_SPECIFIC")?.visible && (
        <DatabaseEngineMetrics />
      )}

      {/* Live Connection Logs Ticker */}
      {widgetsState.find((w) => w.type === "LOGS_STREAM")?.visible && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-[#272a30] dark:bg-[#1a1d23]">
          <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-3 dark:border-[#272a30]">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <Terminal className="h-4 w-4 text-emerald-500" />
                Live Database Connection & Auth Logs Stream
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Real-time connection handshakes, timeouts, and authentication events
              </p>
            </div>

            <span className="flex items-center gap-1.5 text-xs font-mono text-emerald-500">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
              Live Feed ({logs.length} entries)
            </span>
          </div>

          <div className="space-y-2 max-h-60 overflow-y-auto pr-1 text-xs font-mono">
            {logs.slice(0, 8).map((log) => {
              const isErr = log.severity === "ERROR";
              const isWarn = log.severity === "WARN";

              return (
                <div
                  key={log.id}
                  className={`flex flex-col gap-1 rounded-xl p-2.5 transition sm:flex-row sm:items-center sm:justify-between ${
                    isErr
                      ? "bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20"
                      : isWarn
                      ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20"
                      : "bg-slate-50 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 text-[10px]">{log.timestamp}</span>
                    <span
                      className={`rounded px-1.5 py-0.2 text-[9px] font-bold uppercase ${
                        isErr
                          ? "bg-rose-500 text-white"
                          : isWarn
                          ? "bg-amber-500 text-white"
                          : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                      }`}
                    >
                      {log.eventType}
                    </span>
                    <span className="font-bold text-slate-900 dark:text-white">
                      {log.databaseName}
                    </span>
                    <span className="text-slate-500">IP: {log.clientIp}</span>
                    <span className="text-slate-500">User: {log.username}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 text-[10px]">{log.latencyMs}ms</span>
                    {log.details && (
                      <span className="truncate max-w-xs text-slate-500 text-[10px]">
                        {log.details}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
