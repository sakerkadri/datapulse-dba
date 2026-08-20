import React, { useState } from "react";
import { useDBA } from "../../context/DBAContext";
import { ConnectionLog } from "../../types/dba";
import {
  Terminal,
  Search,
  Filter,
  Play,
  Pause,
  Trash2,
  Lock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Copy,
  Check,
  ChevronRight,
  ChevronDown,
} from "lucide-react";

export const ConnectionLogsViewer: React.FC = () => {
  const { logs, clearLogs, isStreaming, setIsStreaming } = useDBA();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEngine, setSelectedEngine] = useState<string>("ALL");
  const [selectedSeverity, setSelectedSeverity] = useState<string>("ALL");
  const [selectedEventType, setSelectedEventType] = useState<string>("ALL");
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredLogs = logs.filter((log) => {
    if (selectedEngine !== "ALL" && log.engine !== selectedEngine) return false;
    if (selectedSeverity !== "ALL" && log.severity !== selectedSeverity) return false;
    if (selectedEventType !== "ALL" && log.eventType !== selectedEventType) return false;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchIp = log.clientIp.toLowerCase().includes(q);
      const matchUser = log.username.toLowerCase().includes(q);
      const matchDb = log.databaseName.toLowerCase().includes(q);
      const matchDetails = log.details?.toLowerCase().includes(q);
      const matchQuery = log.querySummary?.toLowerCase().includes(q);
      return matchIp || matchUser || matchDb || matchDetails || matchQuery;
    }

    return true;
  });

  const handleCopy = (log: ConnectionLog) => {
    const text = `[${log.timestamp}] ${log.engine} (${log.databaseName}) - Event: ${log.eventType} | IP: ${log.clientIp} | User: ${log.username} | Latency: ${log.latencyMs}ms | Details: ${log.details || ""}`;
    navigator.clipboard.writeText(text);
    setCopiedId(log.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-[#272a30] dark:bg-[#1a1d23]">
        <div>
          <h2 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <Terminal className="h-5 w-5 text-indigo-500" />
            Database Connection & Auth Logs Stream
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Real-time audit log of client connection attempts, authentication failures, and query timeouts.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Live Tail Toggle */}
          <button
            onClick={() => setIsStreaming(!isStreaming)}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition cursor-pointer ${
              isStreaming
                ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 border border-emerald-500/30"
                : "bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 border border-amber-500/30"
            }`}
          >
            {isStreaming ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            <span>{isStreaming ? "Pause Live Tail" : "Resume Stream"}</span>
          </button>

          <button
            onClick={clearLogs}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition cursor-pointer"
            title="Clear buffer logs"
          >
            <Trash2 className="h-4 w-4 text-slate-400" />
            <span>Clear Buffer</span>
          </button>
        </div>
      </div>

      {/* Filter Controls Bar */}
      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2 md:grid-cols-4">
        {/* Search input */}
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search IP, User, Query, Details..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 py-2 text-xs font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        {/* Engine filter */}
        <select
          value={selectedEngine}
          onChange={(e) => setSelectedEngine(e.target.value)}
          className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-xs font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer"
        >
          <option value="ALL">All Database Engines</option>
          <option value="PostgreSQL">PostgreSQL</option>
          <option value="SQL Server">SQL Server</option>
          <option value="MySQL">MySQL</option>
          <option value="Oracle">Oracle Database</option>
        </select>

        {/* Severity filter */}
        <select
          value={selectedSeverity}
          onChange={(e) => setSelectedSeverity(e.target.value)}
          className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-xs font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer"
        >
          <option value="ALL">All Severities</option>
          <option value="INFO">INFO Only</option>
          <option value="WARN">WARN Only</option>
          <option value="ERROR">ERROR Only</option>
        </select>

        {/* Event Type filter */}
        <select
          value={selectedEventType}
          onChange={(e) => setSelectedEventType(e.target.value)}
          className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-xs font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer"
        >
          <option value="ALL">All Event Types</option>
          <option value="AUTH_SUCCESS">AUTH_SUCCESS</option>
          <option value="AUTH_FAILURE">AUTH_FAILURE</option>
          <option value="QUERY_TIMEOUT">QUERY_TIMEOUT</option>
          <option value="CONNECTION_EXHAUSTED">CONNECTION_EXHAUSTED</option>
          <option value="SSL_HANDSHAKE_ERROR">SSL_HANDSHAKE_ERROR</option>
        </select>
      </div>

      {/* Connection Logs Feed Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs font-mono">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800/80 dark:text-slate-400">
                <th className="py-3 px-4 font-bold">Time</th>
                <th className="py-3 px-4 font-bold">Engine / Database</th>
                <th className="py-3 px-4 font-bold">Event Type</th>
                <th className="py-3 px-4 font-bold">Client IP</th>
                <th className="py-3 px-4 font-bold">User</th>
                <th className="py-3 px-4 font-bold">Latency</th>
                <th className="py-3 px-4 font-bold text-right">Action</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400 font-sans">
                    No connection logs match the current filters.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  const isErr = log.severity === "ERROR";
                  const isWarn = log.severity === "WARN";

                  return (
                    <React.Fragment key={log.id}>
                      <tr
                        onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                        className={`cursor-pointer transition hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                          isErr
                            ? "bg-rose-500/5 dark:bg-rose-950/10"
                            : isWarn
                            ? "bg-amber-500/5 dark:bg-amber-950/10"
                            : ""
                        }`}
                      >
                        <td className="py-3 px-4 text-slate-400 text-[11px] font-bold">
                          {log.timestamp}
                        </td>

                        <td className="py-3 px-4">
                          <span className="font-extrabold text-slate-900 dark:text-white">
                            {log.databaseName}
                          </span>
                          <span className="ml-1.5 text-[10px] text-slate-400">({log.engine})</span>
                        </td>

                        <td className="py-3 px-4">
                          <span
                            className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                              isErr
                                ? "bg-rose-500 text-white"
                                : isWarn
                                ? "bg-amber-500 text-white"
                                : "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
                            }`}
                          >
                            {log.eventType}
                          </span>
                        </td>

                        <td className="py-3 px-4 font-bold text-slate-800 dark:text-slate-200">
                          {log.clientIp}
                        </td>

                        <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                          {log.username}
                        </td>

                        <td className="py-3 px-4">
                          <span
                            className={`font-bold ${
                              log.latencyMs > 1000
                                ? "text-rose-500"
                                : log.latencyMs > 200
                                ? "text-amber-500"
                                : "text-emerald-500"
                            }`}
                          >
                            {log.latencyMs}ms
                          </span>
                        </td>

                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopy(log);
                              }}
                              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 cursor-pointer"
                              title="Copy Log Row"
                            >
                              {copiedId === log.id ? (
                                <Check className="h-3.5 w-3.5 text-emerald-500" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </button>

                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-slate-400" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-slate-400" />
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Expanded Row Detail Inspector */}
                      {isExpanded && (
                        <tr className="bg-slate-50/80 dark:bg-slate-800/80">
                          <td colSpan={7} className="p-4">
                            <div className="space-y-2 rounded-xl bg-slate-900 p-4 text-slate-100 font-mono text-xs">
                              <div className="flex justify-between border-b border-slate-800 pb-2">
                                <span className="text-emerald-400 font-bold">Log Details Inspector (ID: {log.id})</span>
                                <span className="text-slate-400">{log.engine} Handshake Audit</span>
                              </div>

                              {log.details && (
                                <div className="pt-1">
                                  <span className="text-slate-400">Details Message:</span>
                                  <p className="mt-0.5 text-slate-200">{log.details}</p>
                                </div>
                              )}

                              {log.querySummary && (
                                <div className="pt-2">
                                  <span className="text-amber-400 font-bold">Associated Query Payload:</span>
                                  <pre className="mt-1 rounded bg-slate-950 p-2 text-emerald-300 overflow-x-auto">
                                    {log.querySummary}
                                  </pre>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
