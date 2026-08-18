import React, { useState } from "react";
import { useDBA } from "../../context/DBAContext";
import {
  Mail,
  Send,
  Eye,
  Code,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Server,
  Layers,
  Copy,
  Check,
} from "lucide-react";

export const EmailNotificationManager: React.FC = () => {
  const { channels, emailTemplates, sendTestEmail, incidents, currentUser } = useDBA();

  const [activeTab, setActiveTab] = useState<"TEMPLATE" | "CHANNELS" | "TEST">("TEMPLATE");
  const [selectedTemplateId, setSelectedTemplateId] = useState(emailTemplates[0]?.id || "");
  const [previewMode, setPreviewMode] = useState<"PREVIEW" | "CODE">("PREVIEW");

  // Editable template state
  const activeTemplate = emailTemplates.find((t) => t.id === selectedTemplateId) || emailTemplates[0];
  const [subject, setSubject] = useState(activeTemplate?.subject || "");
  const [bodyHtml, setBodyHtml] = useState(activeTemplate?.bodyHtml || "");

  // Test Email Sender state
  const [recipientEmail, setRecipientEmail] = useState(currentUser.email);
  const [testSending, setTestSending] = useState(false);
  const [testStatus, setTestStatus] = useState<any>(null);

  const handleSendTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setTestSending(true);
    setTestStatus(null);

    try {
      const res = await sendTestEmail(recipientEmail, selectedTemplateId);
      setTestStatus(res);
    } catch (err: any) {
      setTestStatus({ success: false, status: err.message });
    } finally {
      setTestSending(false);
    }
  };

  // Render variables preview
  const sampleInc = incidents[0] || {
    id: "inc-1001",
    databaseName: "pg-analytics-warehouse",
    engine: "PostgreSQL",
    title: "CPU Utilization Critical (96.4%)",
    severity: "CRITICAL",
    currentValue: 96.4,
    thresholdValue: 85.0,
    unit: "%",
    firedAt: new Date().toLocaleTimeString(),
    notes: "High sequential scan on analytics_events table.",
  };

  const renderedPreviewHtml = bodyHtml
    .replaceAll("{{database_name}}", sampleInc.databaseName)
    .replaceAll("{{incident_title}}", sampleInc.title)
    .replaceAll("{{severity}}", sampleInc.severity)
    .replaceAll("{{incident_id}}", sampleInc.id)
    .replaceAll("{{engine}}", sampleInc.engine)
    .replaceAll("{{metric_name}}", "CPU Usage")
    .replaceAll("{{current_value}}", String(sampleInc.currentValue))
    .replaceAll("{{threshold_value}}", String(sampleInc.thresholdValue))
    .replaceAll("{{unit}}", sampleInc.unit)
    .replaceAll("{{fired_at}}", sampleInc.firedAt)
    .replaceAll("{{notes}}", sampleInc.notes || "Sustained high load")
    .replaceAll("{{app_url}}", window.location.href);

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-[#272a30] dark:bg-[#1a1d23]">
        <div>
          <h2 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <Mail className="h-5 w-5 text-indigo-500" />
            Automated Email & Incident Dispatch System
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Configure HTML incident notification templates and test automated email alerts.
          </p>
        </div>

        <div className="flex rounded-xl bg-slate-100 p-1 dark:bg-[#15181e] text-xs font-bold">
          <button
            onClick={() => setActiveTab("TEMPLATE")}
            className={`rounded-lg px-3 py-1.5 transition cursor-pointer ${
              activeTab === "TEMPLATE"
                ? "bg-white text-indigo-600 shadow-sm dark:bg-[#1a1d23] dark:text-indigo-400"
                : "text-slate-600 dark:text-slate-400"
            }`}
          >
            HTML Template Builder
          </button>

          <button
            onClick={() => setActiveTab("CHANNELS")}
            className={`rounded-lg px-3 py-1.5 transition cursor-pointer ${
              activeTab === "CHANNELS"
                ? "bg-white text-indigo-600 shadow-sm dark:bg-[#1a1d23] dark:text-indigo-400"
                : "text-slate-600 dark:text-slate-400"
            }`}
          >
            Delivery Channels ({channels.length})
          </button>

          <button
            onClick={() => setActiveTab("TEST")}
            className={`rounded-lg px-3 py-1.5 transition cursor-pointer ${
              activeTab === "TEST"
                ? "bg-white text-indigo-600 shadow-sm dark:bg-[#1a1d23] dark:text-indigo-400"
                : "text-slate-600 dark:text-slate-400"
            }`}
          >
            Test Email Sender
          </button>
        </div>
      </div>

      {/* TAB 1: HTML TEMPLATE BUILDER & PREVIEW */}
      {activeTab === "TEMPLATE" && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Editor Column */}
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div>
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Email Subject Line Template
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs font-mono font-bold dark:border-slate-700 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  HTML Body Template
                </label>
                <div className="flex gap-1 text-[10px] font-bold">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {"{{database_name}}"}
                  </span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {"{{current_value}}"}
                  </span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {"{{severity}}"}
                  </span>
                </div>
              </div>

              <textarea
                rows={16}
                value={bodyHtml}
                onChange={(e) => setBodyHtml(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-950 p-3 text-xs font-mono text-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          {/* Live Preview Column */}
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <h3 className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <Eye className="h-4 w-4 text-emerald-500" />
                Live HTML Email Preview
              </h3>

              <div className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800 text-[10px] font-bold">
                <button
                  onClick={() => setPreviewMode("PREVIEW")}
                  className={`rounded px-2 py-1 cursor-pointer ${
                    previewMode === "PREVIEW"
                      ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                      : "text-slate-500"
                  }`}
                >
                  Visual
                </button>
                <button
                  onClick={() => setPreviewMode("CODE")}
                  className={`rounded px-2 py-1 cursor-pointer ${
                    previewMode === "CODE"
                      ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                      : "text-slate-500"
                  }`}
                >
                  Raw HTML
                </button>
              </div>
            </div>

            {previewMode === "PREVIEW" ? (
              <div
                className="rounded-xl border border-slate-200 bg-slate-950 p-4 min-h-[400px] overflow-y-auto"
                dangerouslySetInnerHTML={{ __html: renderedPreviewHtml }}
              />
            ) : (
              <pre className="rounded-xl border border-slate-200 bg-slate-950 p-4 text-xs font-mono text-slate-300 min-h-[400px] overflow-x-auto">
                {renderedPreviewHtml}
              </pre>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: CHANNELS */}
      {activeTab === "CHANNELS" && (
        <div className="grid gap-4 md:grid-cols-3">
          {channels.map((chan) => (
            <div
              key={chan.id}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-center justify-between">
                <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">
                  {chan.type}
                </span>
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </div>

              <h4 className="mt-2 text-sm font-extrabold text-slate-900 dark:text-white">
                {chan.name}
              </h4>
              <p className="mt-1 text-xs font-mono text-slate-500 truncate">{chan.target}</p>

              <div className="mt-4 pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-400">
                Status: Active Relay
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TAB 3: TEST EMAIL SENDER */}
      {activeTab === "TEST" && (
        <div className="max-w-xl mx-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <Send className="h-4 w-4 text-emerald-500" />
            Send Test Incident Alert Email
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Tests automated SMTP dispatch to verify email delivery.
          </p>

          <form onSubmit={handleSendTest} className="mt-4 space-y-3 text-xs">
            <div>
              <label className="font-bold">Recipient Email Address</label>
              <input
                type="email"
                required
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <button
              type="submit"
              disabled={testSending}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-700 transition cursor-pointer"
            >
              <Send className="h-4 w-4" />
              <span>{testSending ? "Dispatching Email..." : "Dispatch Test Email"}</span>
            </button>
          </form>

          {testStatus && (
            <div
              className={`mt-4 rounded-xl p-3 text-xs font-mono ${
                testStatus.success
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20"
                  : "bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20"
              }`}
            >
              <p className="font-bold">{testStatus.status}</p>
              <p className="text-[10px] mt-0.5 opacity-80">Message ID: {testStatus.messageId}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
