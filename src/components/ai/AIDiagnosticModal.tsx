import React, { useState, useEffect } from "react";
import { useDBA } from "../../context/DBAContext";
import {
  Sparkles,
  X,
  Copy,
  Check,
  Zap,
  Bot,
  Loader2,
  Code2,
  Database,
  CheckCircle2,
} from "lucide-react";

export const AIDiagnosticModal: React.FC = () => {
  const { aiModalOpen, setAiModalOpen, aiModalContext } = useDBA();

  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (aiModalOpen && aiModalContext) {
      runDiagnosis();
    }
  }, [aiModalOpen, aiModalContext]);

  const runDiagnosis = async () => {
    if (!aiModalContext) return;
    setLoading(true);
    setAnalysis(null);

    try {
      const res = await fetch("/api/ai/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(aiModalContext),
      });

      const data = await res.json();
      setAnalysis(data.analysis || "Diagnosis completed.");
    } catch (err: any) {
      console.error("AI Diagnosis error:", err);
      setAnalysis("Error communicating with AI DBA Assistant service.");
    } finally {
      setLoading(false);
    }
  };

  if (!aiModalOpen || !aiModalContext) return null;

  const handleCopy = () => {
    if (analysis) {
      navigator.clipboard.writeText(analysis);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4 backdrop-blur-md">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-purple-500/30 bg-slate-900 text-slate-100 shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-600/30">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold flex items-center gap-2">
                <span>Gemini AI DBA Auto-Diagnostic Engine</span>
                <span className="rounded bg-purple-500/20 px-2 py-0.5 text-[10px] font-bold text-purple-300">
                  {aiModalContext.databaseType || "Multi-Engine"}
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                {aiModalContext.type === "slow_query"
                  ? "Analyzing Query Execution & Index Strategy"
                  : "Incident Root Cause Analysis & Remediation"}
              </p>
            </div>
          </div>

          <button
            onClick={() => setAiModalOpen(false)}
            className="text-slate-400 hover:text-white transition cursor-pointer p-1"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs font-sans">
          {/* Target Query context preview */}
          {aiModalContext.query && (
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
              <span className="text-[10px] font-bold uppercase text-purple-400">
                Analyzed SQL Statement:
              </span>
              <pre className="mt-1 overflow-x-auto text-emerald-400 font-mono text-[11px]">
                {aiModalContext.query}
              </pre>
            </div>
          )}

          {/* Diagnosis output */}
          {loading ? (
            <div className="py-12 text-center space-y-3">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-purple-500" />
              <p className="text-sm font-bold text-purple-300">
                Evaluating Query Plan, Lock Graphs, and Engine Buffer Hit Ratios...
              </p>
              <p className="text-xs text-slate-500">
                Consulting Gemini 3.6 Flash for DBA recommendations...
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-between items-center bg-slate-950 p-3 rounded-xl border border-slate-800">
                <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-purple-400" />
                  DBA Diagnostic Output
                </span>

                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700 cursor-pointer"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  <span>{copied ? "Copied" : "Copy Analysis"}</span>
                </button>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 font-mono text-xs text-slate-200 leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto">
                {analysis}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-800 bg-slate-950 px-6 py-3 text-right">
          <button
            onClick={() => setAiModalOpen(false)}
            className="rounded-xl bg-purple-600 px-5 py-2 text-xs font-bold text-white hover:bg-purple-700 cursor-pointer"
          >
            Close AI Assistant
          </button>
        </div>
      </div>
    </div>
  );
};
