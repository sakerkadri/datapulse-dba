import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "5mb" }));

// Initialize Gemini SDK with telemetry header
const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    })
  : null;

// Health API
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// AI DBA Diagnostic Assistant Endpoint
app.post("/api/ai/diagnose", async (req, res) => {
  try {
    const { type, query, metrics, databaseType, incidentContext } = req.body;

    if (!ai) {
      // Fallback response if GEMINI_API_KEY is not configured
      return res.json({
        analysis: `[Simulated Diagnosis - Add GEMINI_API_KEY in Secrets for live AI analysis]
Target Engine: ${databaseType || "PostgreSQL"}
Issue Type: ${type || "Performance Spike"}

Key Findings:
1. Sequential scan detected on table with high row count.
2. Missing index on foreign key columns causing buffer pool contention.
3. Locks accumulating in transaction duration > 15s.

Recommended Action:
- Create B-Tree index on high-frequency filtering fields.
- Adjust work_mem or max_worker_processes for parallel query execution.
- Review client connection pool max_connections setting.`,
        recommendations: [
          "Create missing covering indexes for frequent WHERE clauses",
          "Increase memory allocation or inspect deadlock graphs",
          "Kill long-running orphaned transaction ID #94821",
        ],
        suggestedSql: `-- Recommended Index Optimization
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_${(databaseType || "db").toLowerCase()}_perf_opt
ON audit_logs (database_id, created_at DESC)
INCLUDE (execution_time_ms, user_id);`,
      });
    }

    let prompt = "";
    if (type === "slow_query") {
      prompt = `You are a Senior Principal Database Administrator (DBA) expert in ${databaseType || "PostgreSQL, SQL Server, and MySQL"}.
Analyze the following SQL query and performance metrics:

SQL Query:
\`\`\`sql
${query || "SELECT * FROM connection_logs WHERE status = 'failed' ORDER BY timestamp DESC;"}
\`\`\`

Engine / Metrics Context:
${JSON.stringify(metrics || {}, null, 2)}

Provide a structured analysis containing:
1. **Root Cause Analysis**: Why this query/event is causing high latency or IOPS spikes.
2. **Index & Schema Recommendation**: Specific CREATE INDEX or ALTER TABLE statement tailored for ${databaseType || "the engine"}.
3. **Engine-Specific Tuning**: Specific parameters (e.g., PostgreSQL work_mem / pg_stat_statements or SQL Server TempDB / MAXDOP / Index Fragmentation).
4. **Optimized SQL Query Rewrite**: Refactored query for optimal performance.`;
    } else {
      prompt = `You are a Senior Principal Database Administrator (DBA) analyzing a critical database incident.

Database Type: ${databaseType}
Incident Context: ${incidentContext}
Current Metrics: ${JSON.stringify(metrics || {}, null, 2)}

Provide an immediate Incident Action Plan:
1. **Immediate Remediation Steps** (commands or DBA actions to stop outage).
2. **Root Cause Analysis**.
3. **Preventative Threshold Configuration**.`;
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: prompt,
      config: {
        temperature: 0.2,
      },
    });

    const outputText = response.text || "No diagnosis output generated.";

    res.json({
      analysis: outputText,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("Error running AI DBA diagnosis:", error);
    res.status(500).json({
      error: "Failed to run AI diagnosis",
      details: error.message,
    });
  }
});

// Automated Email Dispatch Simulator Endpoint
app.post("/api/notifications/test-email", (req, res) => {
  const { recipient, subject, incident } = req.body;

  // Simulate automated SMTP sending
  console.log(`[SMTP Dispatcher] Sending Incident Alert to: ${recipient}`);
  console.log(`[SMTP Dispatcher] Subject: ${subject}`);

  res.json({
    success: true,
    messageId: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    sentAt: new Date().toISOString(),
    recipient,
    status: "Delivered via DataPulse Automated SMTP Relay",
  });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[DataPulse DBA Sentinel] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
