import React, { useState, useEffect } from "react";
import { useDBA } from "../../context/DBAContext";
import {
  Search,
  Database,
  AlertTriangle,
  Terminal,
  Users,
  Sparkles,
  ArrowRight,
  X,
} from "lucide-react";

export const GlobalSearchPalette: React.FC = () => {
  const {
    searchOpen,
    setSearchOpen,
    databases,
    incidents,
    logs,
    users,
    setSelectedDbId,
    openAiDiagnosis,
  } = useDBA();

  const [query, setQuery] = useState("");

  // Keyboard shortcut listener for Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "Escape") {
        setSearchOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setSearchOpen]);

  if (!searchOpen) return null;

  const q = query.toLowerCase().trim();

  const matchedDbs = q
    ? databases.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.engine.toLowerCase().includes(q) ||
          d.host.toLowerCase().includes(q) ||
          d.databaseName.toLowerCase().includes(q)
      )
    : databases;

  const matchedIncidents = q
    ? incidents.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.databaseName.toLowerCase().includes(q) ||
          i.severity.toLowerCase().includes(q)
      )
    : incidents;

  const matchedLogs = q
    ? logs.filter(
        (l) =>
          l.clientIp.toLowerCase().includes(q) ||
          l.username.toLowerCase().includes(q) ||
          l.eventType.toLowerCase().includes(q) ||
          l.databaseName.toLowerCase().includes(q)
      )
    : logs.slice(0, 5);

  const matchedUsers = q
    ? users.filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          u.role.toLowerCase().includes(q)
      )
    : users;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/60 pt-20 p-4 backdrop-blur-md">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-[#272a30] dark:bg-[#1a1d23] text-slate-900 dark:text-white">
        {/* Search Input Bar */}
        <div className="flex items-center border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-[#272a30] dark:bg-[#15181e]">
          <Search className="h-5 w-5 text-indigo-500 mr-3" />
          <input
            type="text"
            autoFocus
            placeholder="Real-time indexing search (e.g. pg-prod, 192.168, CPU, Saker, PostgreSQL)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-sm font-semibold focus:outline-none placeholder:text-slate-400"
          />
          <button
            onClick={() => setSearchOpen(false)}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search Results List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {/* Databases section */}
          {matchedDbs.length > 0 && (
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                <Database className="h-3.5 w-3.5 text-emerald-500" /> Monitored Database Instances
              </span>
              <div className="space-y-1">
                {matchedDbs.map((db) => (
                  <button
                    key={db.id}
                    onClick={() => {
                      setSelectedDbId(db.id);
                      setSearchOpen(false);
                    }}
                    className="flex w-full items-center justify-between rounded-xl p-2.5 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <div>
                      <span className="font-bold text-slate-900 dark:text-white">{db.name}</span>
                      <span className="ml-2 font-mono text-slate-500">({db.engine} • {db.host})</span>
                    </div>
                    <span className="text-[10px] font-bold text-emerald-500 flex items-center gap-1">
                      Jump to DB <ArrowRight className="h-3 w-3" />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Incidents section */}
          {matchedIncidents.length > 0 && (
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                <AlertTriangle className="h-3.5 w-3.5 text-rose-500" /> Active Alert Incidents
              </span>
              <div className="space-y-1">
                {matchedIncidents.map((inc) => (
                  <button
                    key={inc.id}
                    onClick={() => {
                      openAiDiagnosis({
                        type: "incident",
                        databaseType: inc.engine,
                        incidentContext: inc.title,
                      });
                      setSearchOpen(false);
                    }}
                    className="flex w-full items-center justify-between rounded-xl p-2.5 text-left transition hover:bg-rose-50 dark:hover:bg-rose-950/20 cursor-pointer"
                  >
                    <div>
                      <span className="font-bold text-rose-600 dark:text-rose-400">{inc.title}</span>
                      <span className="ml-2 font-mono text-slate-500">({inc.databaseName})</span>
                    </div>
                    <span className="text-[10px] font-bold text-purple-500 flex items-center gap-1">
                      <Sparkles className="h-3 w-3" /> AI Diagnose
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Logs section */}
          {matchedLogs.length > 0 && (
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                <Terminal className="h-3.5 w-3.5 text-indigo-500" /> Connection Logs Index
              </span>
              <div className="space-y-1">
                {matchedLogs.slice(0, 4).map((log) => (
                  <div
                    key={log.id}
                    className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60 font-mono text-[11px] flex items-center justify-between"
                  >
                    <div>
                      <span className="font-bold text-slate-900 dark:text-white">{log.clientIp}</span>
                      <span className="ml-2 text-slate-500">({log.username} @ {log.databaseName})</span>
                    </div>
                    <span className="text-slate-400">{log.eventType}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
