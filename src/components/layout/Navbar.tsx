import React from "react";
import {
  Database,
  Search,
  Moon,
  Sun,
  Shield,
  FileText,
  Sparkles,
  Activity,
  Play,
  Pause,
  ChevronDown,
  UserCheck,
  AlertTriangle,
} from "lucide-react";
import { useDBA } from "../../context/DBAContext";

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ activeTab, setActiveTab }) => {
  const {
    databases,
    selectedDbId,
    setSelectedDbId,
    theme,
    toggleTheme,
    isStreaming,
    setIsStreaming,
    incidents,
    setSearchOpen,
    currentUser,
    users,
    setCurrentUserRole,
    openAiDiagnosis,
  } = useDBA();

  const firingIncidents = incidents.filter((i) => i.status === "FIRING");

  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur-md dark:border-[#272a30] dark:bg-[#15181e]/90 sm:px-6">
      {/* Left section: App Brand & DB Selector */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-600/20">
            <Database className="h-5 w-5" />
          </div>
          <div className="hidden flex-col sm:flex">
            <span className="text-base tracking-tight font-extrabold leading-none text-slate-900 dark:text-white">
              DataPulse <span className="text-indigo-500 dark:text-indigo-400">Sentinel</span>
            </span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-normal">
              Real-time DBA Monitoring
            </span>
          </div>
        </div>

        <div className="h-6 w-px bg-slate-200 dark:bg-[#272a30] mx-1 hidden sm:block" />

        {/* Global Database Selector Dropdown */}
        <div className="relative">
          <select
            value={selectedDbId}
            onChange={(e) => setSelectedDbId(e.target.value)}
            className="h-9 cursor-pointer rounded-lg border border-slate-200 bg-slate-50 px-3 pr-8 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-[#272a30] dark:bg-[#1a1d23] dark:text-slate-200 dark:hover:bg-[#22262f] focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="ALL">🌐 All Monitored Databases ({databases.length})</option>
            {databases.map((db) => (
              <option key={db.id} value={db.id}>
                {db.engine === "PostgreSQL" ? "🐘" : db.engine === "SQL Server" ? "⚡" : db.engine === "MySQL" ? "🐬" : "🏛️"} {db.name} ({db.databaseName})
              </option>
            ))}
          </select>
        </div>

        {/* Firing Incident Warning Badge */}
        {firingIncidents.length > 0 && (
          <button
            onClick={() => setActiveTab("alerts")}
            className="flex items-center gap-1.5 rounded-lg bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-600 dark:bg-rose-500/20 dark:text-rose-400 border border-rose-500/30 animate-pulse cursor-pointer"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>{firingIncidents.length} Firing</span>
          </button>
        )}
      </div>

      {/* Right controls & Actions */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Real-time streaming ticker */}
        <button
          onClick={() => setIsStreaming(!isStreaming)}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition cursor-pointer ${
            isStreaming
              ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 border border-emerald-500/30"
              : "bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 border border-amber-500/30"
          }`}
          title={isStreaming ? "Live telemetry stream active" : "Telemetry paused"}
        >
          <Activity className={`h-3.5 w-3.5 ${isStreaming ? "animate-spin text-emerald-500" : ""}`} />
          <span className="hidden md:inline">{isStreaming ? "Live 3s" : "Paused"}</span>
          {isStreaming ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
        </button>

        {/* Global Search Shortcut trigger */}
        <button
          onClick={() => setSearchOpen(true)}
          className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs text-slate-500 transition hover:border-slate-300 dark:border-[#272a30] dark:bg-[#1a1d23] dark:text-slate-400 dark:hover:border-slate-700 cursor-pointer"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Search DB, logs, queries...</span>
          <kbd className="hidden rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-mono text-slate-600 dark:bg-[#22262f] dark:text-slate-300 md:inline">
            ⌘K
          </kbd>
        </button>

        {/* AI Assistant Quick Trigger */}
        <button
          onClick={() =>
            openAiDiagnosis({
              type: "slow_query",
              query: "SELECT * FROM connection_logs WHERE severity = 'ERROR' ORDER BY timestamp DESC;",
              databaseType: "PostgreSQL",
              metrics: { cpu: 89.4, activeConnections: 288, latencyMs: 2450 },
            })
          }
          className="hidden md:flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition cursor-pointer"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>AI DBA Assistant</span>
        </button>

        {/* PDF Reports Quick Nav */}
        <button
          onClick={() => setActiveTab("reports")}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 transition hover:bg-slate-100 dark:border-[#272a30] dark:bg-[#1a1d23] dark:text-slate-300 dark:hover:bg-[#22262f] cursor-pointer"
          title="Exportable PDF Reports"
        >
          <FileText className="h-4 w-4" />
        </button>

        {/* Dark/Light Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 transition hover:bg-slate-100 dark:border-[#272a30] dark:bg-[#1a1d23] dark:text-slate-300 dark:hover:bg-[#22262f] cursor-pointer"
          title={`Switch to ${theme === "dark" ? "Light" : "Dark"} Mode`}
        >
          {theme === "dark" ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-slate-700" />}
        </button>

        {/* User Role Switcher */}
        <div className="relative flex items-center gap-2 pl-2 border-l border-slate-200 dark:border-[#272a30]">
          <div className="hidden sm:flex flex-col text-right">
            <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{currentUser.name}</span>
            <span className="text-[10px] font-semibold text-indigo-500 dark:text-indigo-400">
              {currentUser.role.replace("_", " ")}
            </span>
          </div>

          <select
            value={currentUser.id}
            onChange={(e) => setCurrentUserRole(e.target.value)}
            className="h-9 cursor-pointer rounded-lg border border-slate-200 bg-slate-50 text-xs font-medium text-slate-700 dark:border-[#272a30] dark:bg-[#1a1d23] dark:text-slate-200 focus:outline-none"
            title="Switch Simulated Logged-In User Role"
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.role})
              </option>
            ))}
          </select>
        </div>
      </div>
    </header>
  );
};
