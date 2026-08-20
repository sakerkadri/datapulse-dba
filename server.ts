import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { PollingEngine } from "./src/server/polling/PollingEngine";
import { INITIAL_DATABASES } from "./src/mock/dbaData";
import {
  CircuitStateEvent,
  HeartbeatEvent,
  PollingEndpoint,
  StreamSnapshotPayload,
  TelemetryDeltaEvent,
} from "./src/types/polling";
import { IncidentAlert } from "./src/types/dba";
import { OracleCollector } from "./src/collectors/oracle/oracleCollector";
import {
  evaluateOracleRules,
  buildOracleGeminiPrompt,
  buildDeterministicOracleFallback,
} from "./src/diagnostics/rules/oracleRules";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "5mb" }));

// Initialize Central Polling Engine
export const pollingEngine = new PollingEngine({
  defaultZoneConcurrency: 10,
  bufferCapacity: 60,
  circuitBreakerThreshold: 3,
  baseResetTimeoutMs: 10000,
  executionTimeoutMs: 5000,
});

// Register initial database instances
INITIAL_DATABASES.forEach((db) => {
  const zone = db.id.includes("eu")
    ? "eu-west-1"
    : db.id.includes("us")
    ? "us-east-1"
    : "ap-southeast-1";

  const endpoint: PollingEndpoint = {
    id: db.id,
    name: db.name,
    engine: db.engine,
    host: db.host,
    port: db.port,
    databaseName: db.databaseName,
    zone,
    enabled: true,
    cadenceConfig: {
      l1IntervalMs: 5000,
      l2IntervalMs: 15000, // Faster cadence for live dashboard feel
      l3IntervalMs: 120000,
      adaptiveThrottlingEnabled: true,
      adaptiveCpuThresholdPct: 90,
      adaptiveConnThresholdPct: 90,
      adaptiveL3Multiplier: 2.0,
    },
  };

  pollingEngine.registerEndpoint(endpoint, db);
});

// Start the polling loops
pollingEngine.start();

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

// Oracle Telemetry & Rules Diagnostic API
app.get("/api/oracle/telemetry", async (req, res) => {
  try {
    const host = (req.query.host as string) || "localhost";
    const port = Number(req.query.port) || 1521;
    const sid = (req.query.sid as string) || "ORCLCDB";
    const serviceName = req.query.serviceName as string | undefined;
    const user = (req.query.user as string) || "system";
    const isMock = req.query.isMock !== "false";
    const mockScenario = (req.query.scenario as any) || "HEALTHY_CDB";

    const collector = new OracleCollector({
      host,
      port,
      sid,
      serviceName,
      user,
      isMock,
      mockScenario,
    });

    const telemetry = await collector.collect();
    const report = evaluateOracleRules(telemetry);

    res.json({
      success: true,
      telemetry,
      report,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Polling Engine Status API
app.get("/api/polling/status", (req, res) => {
  res.json(pollingEngine.getEngineStats());
});

// Trigger On-Demand Poll API
app.post("/api/polling/trigger/:id", async (req, res) => {
  try {
    const tier = (req.query.tier as any) || "L2";
    await pollingEngine.triggerPoll(req.params.id, tier);
    res.json({ success: true, instanceId: req.params.id, tier });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Real-time Server-Sent Events (SSE) Telemetry Stream
app.get("/api/stream/telemetry", (req, res) => {
  // Set SSE Headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const targetId = req.query.targetId as string | undefined;
  const zone = req.query.zone as string | undefined;

  // 1. Initial Snapshot Frame
  let instances = pollingEngine.getLatestInstances();
  if (targetId && targetId !== "ALL") {
    instances = instances.filter((inst) => inst.id === targetId);
  }
  if (zone) {
    instances = instances.filter((inst) => {
      const ep = pollingEngine.getEndpoint(inst.id);
      return ep?.zone === zone;
    });
  }

  const snapshot: StreamSnapshotPayload = {
    instances,
    timestamp: new Date().toISOString(),
  };
  res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);

  // 2. Event Listeners
  const onTelemetryDelta = (evt: TelemetryDeltaEvent) => {
    if (targetId && targetId !== "ALL" && evt.instanceId !== targetId) return;
    if (zone) {
      const ep = pollingEngine.getEndpoint(evt.instanceId);
      if (ep?.zone !== zone) return;
    }
    res.write(`event: telemetry_delta\ndata: ${JSON.stringify(evt)}\n\n`);
  };

  const onCircuitState = (evt: CircuitStateEvent) => {
    if (targetId && targetId !== "ALL" && evt.endpointId !== targetId) return;
    res.write(`event: circuit_state\ndata: ${JSON.stringify(evt)}\n\n`);
  };

  const onIncidentFired = (evt: IncidentAlert) => {
    if (targetId && targetId !== "ALL" && evt.databaseId !== targetId) return;
    res.write(`event: incident_fired\ndata: ${JSON.stringify(evt)}\n\n`);
  };

  const onHeartbeat = (evt: HeartbeatEvent) => {
    if (targetId && targetId !== "ALL" && evt.endpointId !== targetId) return;
    res.write(`event: heartbeat\ndata: ${JSON.stringify(evt)}\n\n`);
  };

  pollingEngine.on("telemetry_delta", onTelemetryDelta);
  pollingEngine.on("circuit_state", onCircuitState);
  pollingEngine.on("incident_fired", onIncidentFired);
  pollingEngine.on("heartbeat", onHeartbeat);

  // 3. Keepalive pings (every 15 seconds)
  const keepaliveTimer = setInterval(() => {
    res.write(":keepalive\n\n");
  }, 15000);

  // 4. Clean up listeners on disconnect
  req.on("close", () => {
    clearInterval(keepaliveTimer);
    pollingEngine.off("telemetry_delta", onTelemetryDelta);
    pollingEngine.off("circuit_state", onCircuitState);
    pollingEngine.off("incident_fired", onIncidentFired);
    pollingEngine.off("heartbeat", onHeartbeat);
    res.end();
  });
});

// AI DBA Diagnostic Assistant Endpoint
app.post("/api/ai/diagnose", async (req, res) => {
  try {
    const { type, query, metrics, databaseType, incidentContext } = req.body;

    if (databaseType === "Oracle") {
      const report = evaluateOracleRules(metrics || {});
      if (!ai) {
        return res.json(buildDeterministicOracleFallback(metrics || {}, report));
      }
      const prompt = buildOracleGeminiPrompt(metrics || {}, report, { incidentContext, query, type });
      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
        config: {
          temperature: 0.2,
        },
      });

      return res.json({
        analysis: response.text || "No diagnosis output generated.",
        report,
        timestamp: new Date().toISOString(),
      });
    }

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

export async function startServer() {
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

  return app.listen(PORT, "0.0.0.0", () => {
    console.log(`[DataPulse DBA Sentinel] Server running on http://0.0.0.0:${PORT}`);
  });
}

export { app };

if (process.env.NODE_ENV !== "test") {
  startServer();
}
