import React, { useState } from "react";
import { useDBA } from "../../context/DBAContext";
import { ThresholdRule, IncidentAlert } from "../../types/dba";
import {
  Bell,
  AlertTriangle,
  Plus,
  CheckCircle2,
  Sliders,
  Trash2,
  ShieldAlert,
  Zap,
  Sparkles,
  Clock,
  Send,
  Lock,
} from "lucide-react";

export const ThresholdAlertsManager: React.FC = () => {
  const {
    thresholds,
    incidents,
    databases,
    addThreshold,
    updateThreshold,
    deleteThreshold,
    acknowledgeIncident,
    resolveIncident,
    triggerRemediation,
    currentUser,
    openAiDiagnosis,
  } = useDBA();

  const [activeSubTab, setActiveSubTab] = useState<"INCIDENTS" | "RULES">("INCIDENTS");
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [ackModalInc, setAckModalInc] = useState<IncidentAlert | null>(null);
  const [ackNote, setAckNote] = useState("");

  const canEdit = currentUser.permissions.canEditThresholds;
  const canRemediate = currentUser.permissions.canExecuteRemediation;

  // New Rule state
  const [ruleForm, setRuleForm] = useState<Omit<ThresholdRule, "id">>({
    name: "Custom Latency Threshold",
    databaseId: "ALL",
    metricName: "LATENCY",
    operator: ">",
    warningThreshold: 1000,
    criticalThreshold: 2500,
    durationSeconds: 60,
    enabled: true,
    notificationChannels: ["chan-email-dba"],
    description: "Triggers alert when query latency spikes above threshold.",
  });

  const handleCreateRule = (e: React.FormEvent) => {
    e.preventDefault();
    addThreshold(ruleForm);
    setAddModalOpen(false);
  };

  const handleAckSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (ackModalInc) {
      acknowledgeIncident(ackModalInc.id, ackNote);
      setAckModalInc(null);
      setAckNote("");
    }
  };

  const firingList = incidents.filter((i) => i.status === "FIRING");
  const ackList = incidents.filter((i) => i.status === "ACKNOWLEDGED");
  const resolvedList = incidents.filter((i) => i.status === "RESOLVED");

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header & Navigation Tabs */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-[#272a30] dark:bg-[#1a1d23]">
        <div>
          <h2 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <Bell className="h-5 w-5 text-indigo-500" />
            Alert Thresholds & Critical Incidents Center
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Configure real-time monitoring rules and manage active database incident tickets.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Subtabs */}
          <div className="flex rounded-xl bg-slate-100 p-1 dark:bg-[#15181e]">
            <button
              onClick={() => setActiveSubTab("INCIDENTS")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                activeSubTab === "INCIDENTS"
                  ? "bg-white text-indigo-600 shadow-sm dark:bg-[#1a1d23] dark:text-indigo-400"
                  : "text-slate-600 dark:text-slate-400"
              }`}
            >
              <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />
              <span>Active Incidents ({incidents.filter((i) => i.status !== "RESOLVED").length})</span>
            </button>

            <button
              onClick={() => setActiveSubTab("RULES")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                activeSubTab === "RULES"
                  ? "bg-white text-indigo-600 shadow-sm dark:bg-[#1a1d23] dark:text-indigo-400"
                  : "text-slate-600 dark:text-slate-400"
              }`}
            >
              <Sliders className="h-3.5 w-3.5 text-indigo-500" />
              <span>Threshold Rules ({thresholds.length})</span>
            </button>
          </div>

          {activeSubTab === "RULES" && (
            <button
              onClick={() => {
                if (!canEdit) {
                  alert("Your user role does not have 'canEditThresholds' permission.");
                  return;
                }
                setAddModalOpen(true);
              }}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>New Rule</span>
            </button>
          )}
        </div>
      </div>

      {/* SUBTAB: INCIDENTS */}
      {activeSubTab === "INCIDENTS" && (
        <div className="space-y-6">
          {/* Firing Incidents Section */}
          <div className="space-y-3">
            <h3 className="text-xs font-extrabold text-rose-600 dark:text-rose-400 uppercase tracking-wider flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" />
              Firing Alerts ({firingList.length})
            </h3>

            {firingList.length === 0 ? (
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6 text-center">
                <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />
                <h4 className="mt-2 text-sm font-bold text-emerald-700 dark:text-emerald-300">
                  All Systems Operational
                </h4>
                <p className="text-xs text-emerald-600/80 dark:text-emerald-400/80">
                  No active critical threshold breaches across PostgreSQL, SQL Server, or MySQL.
                </p>
              </div>
            ) : (
              firingList.map((inc) => (
                <div
                  key={inc.id}
                  className="rounded-2xl border border-rose-500/40 bg-white p-5 shadow-sm dark:border-rose-900/50 dark:bg-slate-900"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-md bg-rose-500 px-2 py-0.5 text-[10px] font-black uppercase text-white">
                          {inc.severity}
                        </span>
                        <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300">
                          {inc.databaseName} ({inc.engine})
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">Fired: {new Date(inc.firedAt).toLocaleTimeString()}</span>
                      </div>

                      <h4 className="mt-1 text-sm font-extrabold text-rose-600 dark:text-rose-400">
                        {inc.title}
                      </h4>

                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                        Breach value: <strong className="text-rose-600">{inc.currentValue}{inc.unit}</strong> vs threshold {inc.thresholdValue}{inc.unit}
                      </p>

                      {inc.notes && (
                        <div className="mt-2 rounded-xl bg-slate-100 p-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          <strong>Note:</strong> {inc.notes}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() =>
                          openAiDiagnosis({
                            type: "incident",
                            databaseType: inc.engine,
                            incidentContext: `${inc.title}: value ${inc.currentValue}${inc.unit}`,
                          })
                        }
                        className="flex items-center gap-1.5 rounded-xl bg-purple-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-purple-700 transition cursor-pointer"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>AI Diagnosis</span>
                      </button>

                      {inc.remediationScript && (
                        <button
                          onClick={() => {
                            if (!canRemediate) {
                              alert("Your role does not have 'canExecuteRemediation' permission.");
                              return;
                            }
                            triggerRemediation(inc.id);
                          }}
                          className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 transition cursor-pointer"
                        >
                          <Zap className="h-3.5 w-3.5 text-amber-400" />
                          <span>Run Script</span>
                        </button>
                      )}

                      <button
                        onClick={() => setAckModalInc(inc)}
                        className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300 transition cursor-pointer"
                      >
                        Acknowledge
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Acknowledged Incidents Section */}
          {ackList.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-extrabold text-amber-600 dark:text-amber-400 uppercase tracking-wider flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Acknowledged & In Investigation ({ackList.length})
              </h3>

              {ackList.map((inc) => (
                <div
                  key={inc.id}
                  className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 dark:bg-amber-950/20"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white uppercase">
                          ACKNOWLEDGED
                        </span>
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                          {inc.databaseName}
                        </span>
                      </div>
                      <h4 className="mt-1 text-xs font-bold text-slate-900 dark:text-white">
                        {inc.title}
                      </h4>
                      <p className="text-[11px] text-slate-500">
                        Acked by <strong>{inc.acknowledgedBy}</strong> at {inc.acknowledgedAt && new Date(inc.acknowledgedAt).toLocaleTimeString()}
                      </p>
                    </div>

                    <button
                      onClick={() => resolveIncident(inc.id)}
                      className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition cursor-pointer"
                    >
                      Mark Resolved
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SUBTAB: RULES */}
      {activeSubTab === "RULES" && (
        <div className="grid gap-4 md:grid-cols-2">
          {thresholds.map((rule) => (
            <div
              key={rule.id}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        rule.enabled ? "bg-emerald-500" : "bg-slate-400"
                      }`}
                    />
                    <h4 className="text-sm font-extrabold text-slate-900 dark:text-white">
                      {rule.name}
                    </h4>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {rule.description}
                  </p>
                </div>

                <button
                  onClick={() => deleteThreshold(rule.id)}
                  disabled={!canEdit}
                  className="text-slate-400 hover:text-rose-500 transition cursor-pointer"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800">
                  <span className="text-slate-400 text-[10px]">Warning Level:</span>
                  <p className="font-bold text-amber-600 dark:text-amber-400">
                    {rule.metricName} {rule.operator} {rule.warningThreshold}
                  </p>
                </div>

                <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800">
                  <span className="text-slate-400 text-[10px]">Critical Level:</span>
                  <p className="font-bold text-rose-600 dark:text-rose-400">
                    {rule.metricName} {rule.operator} {rule.criticalThreshold}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between text-xs pt-2 border-t border-slate-100 dark:border-slate-800">
                <span className="text-slate-400">Duration: {rule.durationSeconds}s sustained</span>
                <label className="flex items-center gap-2 font-semibold cursor-pointer">
                  <span>Enabled</span>
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(e) => updateThreshold(rule.id, { enabled: e.target.checked })}
                    disabled={!canEdit}
                    className="h-4 w-4 rounded text-emerald-600"
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Acknowledge Modal */}
      {ackModalInc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900 text-slate-900 dark:text-white">
            <h3 className="text-sm font-extrabold flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-500" />
              Acknowledge Incident {ackModalInc.id}
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Add investigation notes for team transparency.
            </p>

            <form onSubmit={handleAckSubmit} className="mt-4 space-y-3">
              <textarea
                required
                rows={3}
                placeholder="e.g. Inspecting lock contention on customer_orders partition table..."
                value={ackNote}
                onChange={(e) => setAckNote(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs dark:border-slate-700 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAckModalInc(null)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-white hover:bg-amber-600"
                >
                  Confirm Ack
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Rule Modal */}
      {addModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900 text-slate-900 dark:text-white">
            <h3 className="text-base font-extrabold flex items-center gap-2">
              <Plus className="h-5 w-5 text-emerald-500" />
              Create Alert Threshold Rule
            </h3>

            <form onSubmit={handleCreateRule} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="font-bold">Rule Name</label>
                <input
                  type="text"
                  required
                  value={ruleForm.name}
                  onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold">Metric Name</label>
                  <select
                    value={ruleForm.metricName}
                    onChange={(e) => setRuleForm({ ...ruleForm, metricName: e.target.value as any })}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800"
                  >
                    <option value="CPU">CPU Usage (%)</option>
                    <option value="MEMORY">Memory Allocation (%)</option>
                    <option value="LATENCY">Query Latency (ms)</option>
                    <option value="CONNECTIONS">Connection Pool (%)</option>
                    <option value="DISK_SPACE">Disk Free (%)</option>
                    <option value="REPLICATION_LAG">Replication Lag (s)</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold">Operator</label>
                  <select
                    value={ruleForm.operator}
                    onChange={(e) => setRuleForm({ ...ruleForm, operator: e.target.value as any })}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800"
                  >
                    <option value=">">Greater than (&gt;)</option>
                    <option value=">=">Greater or equal (&gt;=)</option>
                    <option value="<">Less than (&lt;)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold">Warning Threshold</label>
                  <input
                    type="number"
                    required
                    value={ruleForm.warningThreshold}
                    onChange={(e) => setRuleForm({ ...ruleForm, warningThreshold: Number(e.target.value) })}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>

                <div>
                  <label className="font-bold">Critical Threshold</label>
                  <input
                    type="number"
                    required
                    value={ruleForm.criticalThreshold}
                    onChange={(e) => setRuleForm({ ...ruleForm, criticalThreshold: Number(e.target.value) })}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setAddModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 font-bold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-700"
                >
                  Save Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
