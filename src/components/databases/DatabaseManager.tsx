import React, { useState } from "react";
import { useDBA } from "../../context/DBAContext";
import { DBInstance, DatabaseEngine } from "../../types/dba";
import {
  Database,
  Plus,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Zap,
  Server,
  Lock,
  Eye,
  EyeOff,
  Trash2,
  RefreshCw,
  Sparkles,
  Layers,
  Clock,
  HardDrive,
} from "lucide-react";

export const DatabaseManager: React.FC = () => {
  const { databases, addDatabase, removeDatabase, testDbConnection, openAiDiagnosis } = useDBA();

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; msg: string; success: boolean } | null>(null);

  // New DB Form state
  const [formData, setFormData] = useState({
    name: "",
    engine: "PostgreSQL" as DatabaseEngine,
    version: "PostgreSQL 16.2",
    host: "db-primary.internal",
    port: 5432,
    databaseName: "app_production",
    status: "ONLINE" as DBInstance["status"],
    cpuUsage: 25,
    memoryUsage: 45,
    iops: 800,
    activeConnections: 45,
    maxConnections: 200,
    queryLatencyMs: 8.5,
    slowQueryCount: 0,
    diskFreeGb: 180,
    diskTotalGb: 500,
    replicationLagSeconds: 0,
    bufferHitRatio: 99.1,
    deadlocksCount: 0,
    engineSpecific: {},
  });

  const handleCreateDB = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) return;

    addDatabase({
      ...formData,
      port: Number(formData.port),
    });

    setAddModalOpen(false);
    setFormData({
      name: "",
      engine: "PostgreSQL",
      version: "PostgreSQL 16.2",
      host: "db-primary.internal",
      port: 5432,
      databaseName: "app_production",
      status: "ONLINE",
      cpuUsage: 25,
      memoryUsage: 45,
      iops: 800,
      activeConnections: 45,
      maxConnections: 200,
      queryLatencyMs: 8.5,
      slowQueryCount: 0,
      diskFreeGb: 180,
      diskTotalGb: 500,
      replicationLagSeconds: 0,
      bufferHitRatio: 99.1,
      deadlocksCount: 0,
      engineSpecific: {},
    });
  };

  const handleTestConnection = async (id: string) => {
    setTestingId(id);
    setTestResult(null);
    const res = await testDbConnection(id);
    setTestResult({ id, msg: res.message, success: res.success });
    setTestingId(null);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header & Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-[#272a30] dark:bg-[#1a1d23]">
        <div>
          <h2 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <Database className="h-5 w-5 text-indigo-500" />
            Monitored Database Fleet ({databases.length} Instances)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Manage credentials, test network pings, and inspect multi-engine database parameters.
          </p>
        </div>

        <button
          onClick={() => setAddModalOpen(true)}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-500 transition cursor-pointer shadow-md shadow-indigo-600/20"
        >
          <Plus className="h-4 w-4" />
          <span>Add Database Instance</span>
        </button>
      </div>

      {/* Database Cards Grid */}
      <div className="grid gap-6 md:grid-cols-2">
        {databases.map((db) => {
          const isOnline = db.status === "ONLINE";
          const isHighLoad = db.status === "HIGH_LOAD";
          const isCritical = db.status === "CRITICAL";

          const statusBadge = isCritical
            ? "bg-rose-500 text-white"
            : isHighLoad
            ? "bg-amber-500 text-white"
            : "bg-emerald-500 text-white";

          return (
            <div
              key={db.id}
              className={`relative flex flex-col justify-between rounded-2xl border p-5 transition shadow-sm hover:shadow-md ${
                isCritical
                  ? "border-rose-500/40 bg-rose-500/5 dark:bg-rose-950/20"
                  : isHighLoad
                  ? "border-amber-500/40 bg-amber-500/5 dark:bg-amber-950/20"
                  : "border-slate-200 bg-white dark:border-[#272a30] dark:bg-[#1a1d23]"
              }`}
            >
              <div>
                {/* Instance Header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-xl shadow-inner">
                      {db.engine === "PostgreSQL"
                        ? "🐘"
                        : db.engine === "SQL Server"
                        ? "⚡"
                        : db.engine === "MySQL"
                        ? "🐬"
                        : "🏛️"}
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
                          {db.name}
                        </h3>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${statusBadge}`}
                        >
                          {db.status}
                        </span>
                      </div>
                      <p className="text-xs font-mono text-slate-500 dark:text-slate-400">
                        {db.engine} • {db.databaseName}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => removeDatabase(db.id)}
                    className="text-slate-400 hover:text-rose-500 transition cursor-pointer p-1"
                    title="Remove Database"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {/* Host & Connection Parameters */}
                <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs font-mono text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                  <div className="flex justify-between py-1 border-b border-slate-200/60 dark:border-slate-700/60">
                    <span className="text-slate-400">Endpoint Host:</span>
                    <span className="font-bold">{db.host}:{db.port}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-400">Engine Version:</span>
                    <span className="truncate max-w-[200px] text-right">{db.version}</span>
                  </div>
                </div>

                {/* Metrics Breakdown Grid */}
                <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-xl border border-slate-200 p-2 dark:border-slate-800">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">CPU Load</span>
                    <p
                      className={`text-sm font-black ${
                        db.cpuUsage > 85 ? "text-rose-500" : "text-slate-900 dark:text-white"
                      }`}
                    >
                      {db.cpuUsage}%
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-2 dark:border-slate-800">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Avg Latency</span>
                    <p
                      className={`text-sm font-black ${
                        db.queryLatencyMs > 500 ? "text-rose-500" : "text-slate-900 dark:text-white"
                      }`}
                    >
                      {db.queryLatencyMs}ms
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-2 dark:border-slate-800">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Pool Usage</span>
                    <p className="text-sm font-black text-slate-900 dark:text-white">
                      {db.activeConnections}/{db.maxConnections}
                    </p>
                  </div>
                </div>
              </div>

              {/* Actions Footer */}
              <div className="mt-5 space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => handleTestConnection(db.id)}
                    disabled={testingId === db.id}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 transition cursor-pointer"
                  >
                    {testingId === db.id ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-emerald-500" />
                    ) : (
                      <Zap className="h-3.5 w-3.5 text-amber-500" />
                    )}
                    <span>{testingId === db.id ? "Pinging Host..." : "Test Connection"}</span>
                  </button>

                  <button
                    onClick={() =>
                      openAiDiagnosis({
                        type: "slow_query",
                        databaseType: db.engine,
                        query: `SELECT * FROM ${db.databaseName} ORDER BY latency DESC LIMIT 5;`,
                        metrics: { cpu: db.cpuUsage, latency: db.queryLatencyMs },
                      })
                    }
                    className="flex items-center gap-1.5 rounded-xl bg-purple-600 px-3 py-2 text-xs font-bold text-white hover:bg-purple-700 transition cursor-pointer"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>AI Audit</span>
                  </button>
                </div>

                {/* Test Result Feedback Alert */}
                {testResult && testResult.id === db.id && (
                  <div
                    className={`rounded-xl p-2.5 text-xs font-mono font-medium ${
                      testResult.success
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20"
                        : "bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20"
                    }`}
                  >
                    {testResult.msg}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add New Database Modal */}
      {addModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900 text-slate-900 dark:text-white">
            <h3 className="text-base font-extrabold flex items-center gap-2">
              <Database className="h-5 w-5 text-emerald-500" />
              Register New Database Instance
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Configure connection parameters for PostgreSQL, SQL Server, or MySQL engines.
            </p>

            <form onSubmit={handleCreateDB} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300">Instance Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. pg-orders-prod-us"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300">Database Engine</label>
                  <select
                    value={formData.engine}
                    onChange={(e) => {
                      const eng = e.target.value as DatabaseEngine;
                      const port = eng === "PostgreSQL" ? 5432 : eng === "SQL Server" ? 1433 : eng === "MySQL" ? 3306 : 1521;
                      setFormData({ ...formData, engine: eng, port });
                    }}
                    className="mt-1 w-full cursor-pointer rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="PostgreSQL">PostgreSQL</option>
                    <option value="SQL Server">Microsoft SQL Server</option>
                    <option value="MySQL">MySQL</option>
                    <option value="Oracle">Oracle Database (CDB/PDB)</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300">Database Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. customer_db"
                    value={formData.databaseName}
                    onChange={(e) => setFormData({ ...formData, databaseName: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="font-bold text-slate-700 dark:text-slate-300">Host / IP Endpoint</label>
                  <input
                    type="text"
                    required
                    placeholder="db.prod.internal"
                    value={formData.host}
                    onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300">Port</label>
                  <input
                    type="number"
                    required
                    value={formData.port}
                    onChange={(e) => setFormData({ ...formData, port: Number(e.target.value) })}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setAddModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 font-bold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-700 transition cursor-pointer"
                >
                  Save & Connect
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
