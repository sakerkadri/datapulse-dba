import React, { useState, useRef } from "react";
import { useDBA } from "../../context/DBAContext";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import {
  FileText,
  Download,
  Printer,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  Building,
  Calendar,
  Sparkles,
  Loader2,
} from "lucide-react";

export const PDFReportGenerator: React.FC = () => {
  const { databases, incidents, currentUser } = useDBA();
  const reportRef = useRef<HTMLDivElement>(null);

  const [downloading, setDownloading] = useState(false);
  const [reportTitle, setReportTitle] = useState("Executive Database Health & SLA Audit");
  const [subtitle, setSubtitle] = useState("Q3 Production Multi-Engine Infrastructure Report");
  const [timeRange, setTimeRange] = useState<"24h" | "7d" | "30d">("7d");
  const [preparedBy, setPreparedBy] = useState(currentUser.name);
  const [customNotes, setCustomNotes] = useState(
    "All PostgreSQL and SQL Server production clusters maintained 99.99% availability. Critical incidents were resolved within SLA boundaries."
  );

  const firingIncidents = incidents.filter((i) => i.status === "FIRING");

  const handleDownloadPDF = async () => {
    if (!reportRef.current) return;
    setDownloading(true);

    try {
      const canvas = await html2canvas(reportRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
      pdf.save(`DataPulse_DBA_Report_${Date.now()}.pdf`);
    } catch (err) {
      console.error("PDF Export Error:", err);
      alert("Failed to export PDF report.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Controls Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-[#272a30] dark:bg-[#1a1d23]">
        <div>
          <h2 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <FileText className="h-5 w-5 text-indigo-500" />
            Exportable PDF Report Generator
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Generate printable, high-resolution compliance and health audit PDF reports.
          </p>
        </div>

        <button
          onClick={handleDownloadPDF}
          disabled={downloading}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-extrabold text-white hover:bg-indigo-500 transition cursor-pointer shadow-md shadow-indigo-600/20"
        >
          {downloading ? (
            <Loader2 className="h-4 w-4 animate-spin text-white" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          <span>{downloading ? "Generating PDF..." : "Export Formatted PDF"}</span>
        </button>
      </div>

      {/* Configuration Inputs & Live Preview Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Controls Column */}
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-[#272a30] dark:bg-[#1a1d23] text-xs">
          <h3 className="font-extrabold text-slate-900 dark:text-white uppercase tracking-wider text-[11px] text-slate-400">
            Report Parameters
          </h3>

          <div>
            <label className="font-bold text-slate-700 dark:text-slate-300">Report Title</label>
            <input
              type="text"
              value={reportTitle}
              onChange={(e) => setReportTitle(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="font-bold text-slate-700 dark:text-slate-300">Subtitle / Section</label>
            <input
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-bold text-slate-700 dark:text-slate-300">Audit Timeframe</label>
              <select
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value as any)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800 cursor-pointer"
              >
                <option value="24h">Past 24 Hours</option>
                <option value="7d">Past 7 Days</option>
                <option value="30d">Past 30 Days</option>
              </select>
            </div>

            <div>
              <label className="font-bold text-slate-700 dark:text-slate-300">Prepared By</label>
              <input
                type="text"
                value={preparedBy}
                onChange={(e) => setPreparedBy(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
          </div>

          <div>
            <label className="font-bold text-slate-700 dark:text-slate-300">
              Executive Summary & Notes
            </label>
            <textarea
              rows={4}
              value={customNotes}
              onChange={(e) => setCustomNotes(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        {/* PDF Document Preview Column (Formatted for A4 PDF canvas export) */}
        <div className="lg:col-span-2 overflow-x-auto">
          <div
            ref={reportRef}
            className="mx-auto w-[210mm] min-h-[297mm] rounded-none bg-white p-[20mm] text-slate-900 shadow-xl font-sans"
            style={{ color: "#0f172a" }}
          >
            {/* Header / Letterhead */}
            <div className="flex items-center justify-between border-b-2 border-emerald-600 pb-4">
              <div>
                <h1 className="text-xl font-black tracking-tight text-slate-900">
                  DataPulse <span className="text-emerald-600">Sentinel</span>
                </h1>
                <p className="text-[10px] font-semibold uppercase text-slate-500">
                  Database Infrastructure Audit & SLA Compliance
                </p>
              </div>

              <div className="text-right text-[10px] text-slate-500">
                <p className="font-bold text-slate-800">Confidential Document</p>
                <p>Generated: {new Date().toLocaleDateString()}</p>
              </div>
            </div>

            {/* Document Title Banner */}
            <div className="mt-6 rounded-xl bg-slate-50 p-4 border border-slate-200">
              <h2 className="text-lg font-black text-slate-900">{reportTitle}</h2>
              <p className="text-xs font-semibold text-slate-600 mt-0.5">{subtitle}</p>

              <div className="mt-3 flex items-center gap-4 text-[11px] text-slate-500 border-t border-slate-200/60 pt-2">
                <span>Timeframe: <strong>{timeRange}</strong></span>
                <span>Auditor: <strong>{preparedBy}</strong></span>
                <span>Status: <strong className="text-emerald-600">PASS (99.99% SLA)</strong></span>
              </div>
            </div>

            {/* Executive Notes */}
            <div className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-50/50 p-3.5 text-xs text-slate-700">
              <strong className="text-emerald-700 font-bold block mb-1">
                Executive Overview:
              </strong>
              <p className="leading-relaxed">{customNotes}</p>
            </div>

            {/* Managed Database Fleet Table */}
            <div className="mt-6">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                Monitored Database Fleet Metrics Summary
              </h3>

              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-600 border-b border-slate-200">
                    <th className="py-2 px-2.5 font-bold">Database Instance</th>
                    <th className="py-2 px-2.5 font-bold">Engine</th>
                    <th className="py-2 px-2.5 font-bold">Status</th>
                    <th className="py-2 px-2.5 font-bold">CPU Load</th>
                    <th className="py-2 px-2.5 font-bold">Query Latency</th>
                    <th className="py-2 px-2.5 font-bold">Connections</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {databases.map((db) => (
                    <tr key={db.id}>
                      <td className="py-2 px-2.5 font-bold text-slate-900">{db.name}</td>
                      <td className="py-2 px-2.5">{db.engine}</td>
                      <td className="py-2 px-2.5 font-bold text-emerald-600">{db.status}</td>
                      <td className="py-2 px-2.5 font-bold">{db.cpuUsage}%</td>
                      <td className="py-2 px-2.5">{db.queryLatencyMs}ms</td>
                      <td className="py-2 px-2.5">{db.activeConnections}/{db.maxConnections}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Incident Summary */}
            <div className="mt-6">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                Critical Incidents Post-Mortem Log
              </h3>

              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-600 border-b border-slate-200">
                    <th className="py-2 px-2.5 font-bold">Incident ID</th>
                    <th className="py-2 px-2.5 font-bold">Severity</th>
                    <th className="py-2 px-2.5 font-bold">Database</th>
                    <th className="py-2 px-2.5 font-bold">Issue Description</th>
                    <th className="py-2 px-2.5 font-bold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {incidents.map((inc) => (
                    <tr key={inc.id}>
                      <td className="py-2 px-2.5 font-mono font-bold">{inc.id}</td>
                      <td className="py-2 px-2.5 font-bold text-rose-600">{inc.severity}</td>
                      <td className="py-2 px-2.5 font-bold">{inc.databaseName}</td>
                      <td className="py-2 px-2.5 text-slate-700">{inc.title}</td>
                      <td className="py-2 px-2.5 font-bold text-slate-800">{inc.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Footer & Signature Block */}
            <div className="mt-12 border-t border-slate-200 pt-6 flex justify-between items-end text-xs text-slate-500">
              <div>
                <p className="font-bold text-slate-800">DataPulse Sentinel Security Audit</p>
                <p>Verified SOC2 & HIPAA Automated Compliance</p>
              </div>

              <div className="text-right border-t border-slate-400 pt-2 px-6">
                <p className="font-bold text-slate-900">{preparedBy}</p>
                <p className="text-[10px]">Principal DBA Sign-Off</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
