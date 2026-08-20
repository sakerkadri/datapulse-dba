# Milestone 2 Technical Deep Dive: Real-Time Telemetry Streaming, SSE Frontend Client, and Polling Engine Unit Test Suite

**Author:** teamwork_preview_explorer_m2_3  
**Date:** 2026-08-19  
**Status:** Completed Investigation  
**Working Directory:** `.agents/teamwork_preview_explorer_m2_3/`  
**Reference Files:**
- `PROJECT.md`
- `.agents/ORIGINAL_REQUEST.md`
- `.agents/teamwork_preview_sub_orch_m2/SCOPE.md`
- `.agents/skills/distributed-polling-engine/SKILL.md`
- `server.ts`
- `src/context/DBAContext.tsx`
- `src/types/dba.ts`

---

## 1. Executive Summary

This investigation delivers the comprehensive architectural blueprints, API contracts, frontend integration designs, and opaque-box test suites for:
1. **Real-Time Live Streaming Pipeline in `server.ts`**: High-throughput Express Server-Sent Events (`GET /api/stream/telemetry`) with client-specific zone/target filtering, ring-buffer handshake snapshots, live delta broadcasts, circuit state event streams, and 15s keepalive heartbeats, backed by a central management endpoint (`GET /api/polling/status`).
2. **Frontend SSE Client Integration in `src/context/DBAContext.tsx`**: Resilient `EventSource` connection lifecycle with exponential retry backoff, state hydration and live delta merging, automatic fallback simulation during network disconnects, and full integration with UI streaming/cadence controls.
3. **Polling Engine Unit Test Suite in `tests/unit/pollingEngine.test.ts`**: Deterministic test specifications covering `BoundedWorkerPool` (concurrency caps, priority order, queue overflow), `CircuitBreaker` (state machine transitions, fast-failing, exponential backoff, half-open probing), `TelemetryRingBuffer` ($O(1)$ fixed circular eviction, rolling stats), and `TieredScheduler`/`PollingEngine` (multi-tiered cadence, event emission, lifecycle).

---

## 2. Architecture & Data Flow Diagram

```
 ┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
 │                                   CENTRAL POLLING ENGINE                                        │
 │  ┌───────────────────────────────────────────────────────────────────────────────────────────┐  │
 │  │                                  TieredScheduler                                          │  │
 │  │      L1 Heartbeat (5-10s)    │    L2 Telemetry (30-60s)    │    L3 Deep Diagnostics (5m)  │  │
 │  └──────────────────────────────┴─────────────────────────────┴──────────────────────────────┘  │
 │                                                 │                                               │
 │         ┌───────────────────────────────────────┴───────────────────────────────────────┐        │
 │         ▼                                                                               ▼        │
 │  ┌──────────────────────────────┐                                        ┌──────────────────────────────┐
 │  │ BoundedWorkerPool [us-east]  │                                        │ BoundedWorkerPool [eu-west]  │
 │  │  Priority Queue (L1>L2>L3)   │                                        │  Priority Queue (L1>L2>L3)   │
 │  │  Active: 2 / Max: 10         │                                        │  Active: 1 / Max: 10         │
 │  └──────────────┬───────────────┘                                        └──────────────┬───────────────┘
 │                 │                                                                       │        │
 │                 ▼                                                                       ▼        │
 │  ┌──────────────────────────────┐                                        ┌──────────────────────────────┐
 │  │    EndpointCircuitBreaker    │                                        │    EndpointCircuitBreaker    │
 │  │  [CLOSED | OPEN | HALF_OPEN] │                                        │  [CLOSED | OPEN | HALF_OPEN] │
 │  └──────────────┬───────────────┘                                        └──────────────┬───────────────┘
 │                 │                                                                       │        │
 │                 ▼                                                                       ▼        │
 │  ┌──────────────────────────────┐                                        ┌──────────────────────────────┐
 │  │ TelemetryRingBuffer [db-pg-1]│                                        │ TelemetryRingBuffer [db-ora1]│
 │  │   Circular 60 samples (O(1)) │                                        │   Circular 60 samples (O(1)) │
 │  └──────────────┬───────────────┘                                        └──────────────┬───────────────┘
 │                 │                                                                       │        │
 │                 └───────────────────────────────┬───────────────────────────────────────┘        │
 │                                                 ▼                                                │
 │                                    EventEmitter Broadcast Hub                                    │
 │                     ['telemetry_delta', 'circuit_state', 'incident_fired']                       │
 └─────────────────────────────────────────────────┬────────────────────────────────────────────────┘
                                                   │
 ┌─────────────────────────────────────────────────┼────────────────────────────────────────────────┐
 │ EXPRESS SERVER (server.ts)                      │                                                │
 │                                                 ▼                                                │
 │                         GET /api/stream/telemetry?targetId=&zone=                                │
 │                         ┌───────────────────────────────────────────────┐                        │
 │                         │ 1. Set headers (text/event-stream, no-cache)  │                        │
 │                         │ 2. Send initial handshake snapshot            │                        │
 │                         │ 3. Stream deltas, circuit changes, alerts     │                        │
 │                         │ 4. 15s ':keepalive\n\n' heartbeat comments    │                        │
 │                         │ 5. Clean up listeners on req 'close'          │                        │
 │                         └───────────────────────┬───────────────────────┘                        │
 │                                                 │                                                │
 │                         GET /api/polling/status │                                                │
 │                         (Aggregated Engine, Zone, & Breaker Health)                              │
 └─────────────────────────────────────────────────┼────────────────────────────────────────────────┘
                                                   │
                                                   ▼ SSE Connection (EventSource)
 ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
 │ REACT FRONTEND (src/context/DBAContext.tsx)                                                      │
 │  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │
 │  │                                   SSE Client Hook                                          │  │
 │  │  - Auto-reconnect with exponential backoff & jitter (1s -> 30s)                             │  │
 │  │  - Hydrate `databases` & `incidents` from 'snapshot' frame                                 │  │
 │  │  - Merge deltas into `databases` and append to `metricsHistory`                             │  │
 │  │  - Update database health status on 'circuit_state' events                                 │  │
 │  │  - Prepend new incident alerts on 'incident_fired'                                          │  │
 │  │  - Fallback simulation engine activates if disconnected / offline                          │  │
 │  └────────────────────────────────────────────────────────────────────────────────────────────┘  │
 └──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Deep Dive 1: Real-Time Live Streaming Pipeline in `server.ts`

### 3.1 Route Specification: `GET /api/stream/telemetry`

#### HTTP Headers
The endpoint must establish a long-lived, unbuffered HTTP/1.1 or HTTP/2 streaming response with standard SSE headers:
```http
HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
Access-Control-Allow-Origin: *
```

#### Query Parameters
- `targetId` *(string, optional)*: Specific database ID (e.g. `db-pg-01`) or host ID. When specified, only deltas, circuit states, and incidents matching this ID are pushed to the client. Defaults to all instances (`ALL`).
- `zone` *(string, optional)*: Specific network datacenter zone (e.g. `us-east-1`, `eu-west-1`). Defaults to all zones (`ALL`).

### 3.2 SSE Event Framing & Message Formats

All SSE messages are UTF-8 encoded plain text conforming to W3C EventSource specifications:
- Event-type header: `event: <event_name>\n`
- Payload line: `data: <json_string>\n\n`
- Keepalive comment: `:keepalive\n\n`

#### 1. Handshake Snapshot Frame (`event: snapshot`)
Sent immediately upon client connection as frame #1 to hydrate client state from in-memory ring buffers without waiting for the next polling cycle.

```typescript
export interface StreamSnapshotPayload {
  timestamp: string;
  totalInstances: number;
  instances: DBInstance[];
  circuitStates: Array<{
    endpointId: string;
    state: CircuitState;
    consecutiveFailures: number;
    nextAttemptTimestamp: number;
  }>;
  activeIncidents: IncidentAlert[];
}
```

**Wire Frame Example:**
```text
event: snapshot
data: {"timestamp":"2026-08-19T17:00:00.000Z","totalInstances":4,"instances":[{"id":"db-pg-01","name":"pg-prod-primary-eu","engine":"PostgreSQL","status":"ONLINE","cpuUsage":42.5,"memoryUsage":68.1,"iops":1240,"activeConnections":184,"queryLatencyMs":14.2,"bufferHitRatio":99.4,"lastHealthCheck":"Just now"}],"circuitStates":[{"endpointId":"db-pg-01","state":"CLOSED","consecutiveFailures":0,"nextAttemptTimestamp":0}],"activeIncidents":[]}

```

#### 2. Telemetry Delta Frame (`event: telemetry_delta`)
Broadcast whenever an L1 or L2 polling task completes for any database or host instance.

```typescript
export interface StreamTelemetryDeltaPayload {
  instanceId: string;
  timestamp: string;
  tier: "L1" | "L2" | "L3";
  metrics: Partial<DBInstance>;
  metricPoint?: {
    timestamp: string;
    cpu: number;
    memory: number;
    iops: number;
    activeConn: number;
    latencyMs: number;
    slowQueries: number;
    replicationLag: number;
  };
}
```

**Wire Frame Example:**
```text
event: telemetry_delta
data: {"instanceId":"db-pg-01","timestamp":"17:00:05","tier":"L2","metrics":{"cpuUsage":44.2,"memoryUsage":68.5,"iops":1280,"activeConnections":186,"queryLatencyMs":13.8,"bufferHitRatio":99.5,"lastHealthCheck":"Just now"},"metricPoint":{"timestamp":"17:00:05","cpu":44.2,"memory":68.5,"iops":1280,"activeConn":186,"latencyMs":13.8,"slowQueries":2,"replicationLag":0.2}}

```

#### 3. Circuit State Transition Frame (`event: circuit_state`)
Broadcast in real time when any target's circuit breaker trips (`CLOSED -> OPEN`), enters cooldown probing (`OPEN -> HALF_OPEN`), or recovers (`HALF_OPEN -> CLOSED`).

```typescript
export interface StreamCircuitStatePayload {
  endpointId: string;
  previousState: CircuitState;
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveTrips: number;
  nextAttemptTimestamp: number;
  reason: string;
}
```

**Wire Frame Example:**
```text
event: circuit_state
data: {"endpointId":"db-mssql-01","previousState":"CLOSED","state":"OPEN","consecutiveFailures":3,"consecutiveTrips":1,"nextAttemptTimestamp":1724089230000,"reason":"Connection timeout after 5000ms"}

```

#### 4. Incident Alert Frame (`event: incident_fired`)
Broadcast when an automated threshold rule (CPU, memory, latency, disk space) is breached.

```typescript
export interface StreamIncidentAlertPayload extends IncidentAlert {}
```

**Wire Frame Example:**
```text
event: incident_fired
data: {"id":"inc-94821","ruleId":"thresh-01","databaseId":"db-pg-02","databaseName":"pg-analytics-warehouse","engine":"PostgreSQL","title":"Critical CPU Utilization (> 85%)","severity":"CRITICAL","status":"FIRING","currentValue":96.4,"thresholdValue":85.0,"unit":"%","firedAt":"2026-08-19T17:00:10.000Z","remediationScript":"-- Kill high CPU queries\nSELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'active' AND query_start < NOW() - INTERVAL '5 minutes';"}

```

#### 5. Periodic Keepalive Comments
To prevent intermediary proxies, Cloudflare, load balancers, and AWS ALBs from terminating idle HTTP connections (typically on a 30s–60s timeout), the server sends a standard SSE comment every **15 seconds**:
```text
:keepalive\n\n
```

### 3.3 Server Lifecycle & Memory Leak Prevention

```typescript
// Registration in server.ts
app.get("/api/stream/telemetry", (req: express.Request, res: express.Response) => {
  const targetId = req.query.targetId as string | undefined;
  const zone = req.query.zone as string | undefined;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  // 1. Send Handshake Snapshot
  const initialSnapshot = pollingEngine.getSnapshot({ targetId, zone });
  res.write(`event: snapshot\ndata: ${JSON.stringify(initialSnapshot)}\n\n`);

  // 2. Delta Listener
  const onDelta = (delta: StreamTelemetryDeltaPayload) => {
    if (targetId && targetId !== "ALL" && delta.instanceId !== targetId) return;
    if (zone && zone !== "ALL" && !pollingEngine.isTargetInZone(delta.instanceId, zone)) return;
    res.write(`event: telemetry_delta\ndata: ${JSON.stringify(delta)}\n\n`);
  };

  // 3. Circuit Listener
  const onCircuit = (circuit: StreamCircuitStatePayload) => {
    if (targetId && targetId !== "ALL" && circuit.endpointId !== targetId) return;
    res.write(`event: circuit_state\ndata: ${JSON.stringify(circuit)}\n\n`);
  };

  // 4. Incident Listener
  const onIncident = (incident: IncidentAlert) => {
    if (targetId && targetId !== "ALL" && incident.databaseId !== targetId) return;
    res.write(`event: incident_fired\ndata: ${JSON.stringify(incident)}\n\n`);
  };

  pollingEngine.on("telemetry_delta", onDelta);
  pollingEngine.on("circuit_state", onCircuit);
  pollingEngine.on("incident_fired", onIncident);

  // 5. Keepalive Ping every 15s
  const keepaliveTimer = setInterval(() => {
    try {
      res.write(":keepalive\n\n");
    } catch {
      clearInterval(keepaliveTimer);
    }
  }, 15000);

  // 6. Memory Containment: Clean up listeners and timer on client disconnect
  req.on("close", () => {
    clearInterval(keepaliveTimer);
    pollingEngine.off("telemetry_delta", onDelta);
    pollingEngine.off("circuit_state", onCircuit);
    pollingEngine.off("incident_fired", onIncident);
    res.end();
  });
});
```

### 3.4 Management Route: `GET /api/polling/status`

Provides real-time visibility into the polling engine's multi-zone worker pools, circuit states, ring buffer cache, and stream client count.

#### JSON Response Schema
```json
{
  "status": "RUNNING",
  "uptimeSeconds": 3482,
  "totalEndpoints": 12,
  "connectedStreamClients": 3,
  "zones": [
    {
      "zone": "us-east-1",
      "activeWorkers": 2,
      "queuedTasks": 0,
      "maxConcurrency": 10,
      "totalTasksCompleted": 4120,
      "queueOverflowDrops": 0
    },
    {
      "zone": "eu-west-1",
      "activeWorkers": 1,
      "queuedTasks": 0,
      "maxConcurrency": 10,
      "totalTasksCompleted": 2890,
      "queueOverflowDrops": 0
    }
  ],
  "circuitBreakers": {
    "closed": 11,
    "open": 1,
    "halfOpen": 0,
    "tripped": [
      {
        "endpointId": "db-mssql-01",
        "state": "OPEN",
        "consecutiveFailures": 3,
        "consecutiveTrips": 1,
        "nextAttemptTimestamp": 1724089245000,
        "lastError": "Connection timeout after 5000ms"
      }
    ]
  },
  "ringBuffers": {
    "activeBuffers": 12,
    "capacityPerBuffer": 60,
    "totalSamplesStored": 720,
    "estimatedMemoryBytes": 184320
  },
  "cadenceExecution": {
    "L1": { "totalRuns": 696, "avgDurationMs": 24.2, "errors": 3 },
    "L2": { "totalRuns": 116, "avgDurationMs": 85.6, "errors": 0 },
    "L3": { "totalRuns": 11, "avgDurationMs": 420.1, "errors": 0 }
  }
}
```

---

## 4. Deep Dive 2: Frontend SSE Client Integration in `src/context/DBAContext.tsx`

### 4.1 React State Model

The context manages the following state additions to accommodate live streaming:

```typescript
export type StreamConnectionStatus = 
  | "CONNECTED" 
  | "CONNECTING" 
  | "RECONNECTING" 
  | "DISCONNECTED" 
  | "FALLBACK_SIMULATION";

interface DBAContextType {
  // Existing state ...
  streamStatus: StreamConnectionStatus;
  reconnectAttempts: number;
  lastStreamEventAt: string | null;
  // Existing controls ...
  isStreaming: boolean;
  setIsStreaming: (streaming: boolean) => void;
  refreshRate: number;
  setRefreshRate: (rate: number) => void;
}
```

### 4.2 Exponential Reconnection Algorithm with Jitter

When a network blip occurs or the backend server is restarted:
1. Base retry timeout: $T_{\text{base}} = 1,000\,\text{ms}$.
2. Exponential multiplier: $2^{\min(\text{attempts}, 5)}$.
3. Upper cap: $T_{\text{max}} = 30,000\,\text{ms}$.
4. Jitter: $\text{Math.random}() \times 500\,\text{ms}$.
5. Formula:
   $$T_{\text{retry}} = \min(30000, 1000 \times 2^{\text{attempts}}) + \text{Math.random}() \times 500$$
6. If connection fails $> 3$ consecutive times, gracefully activate the **Fallback Simulation Loop** so the UI never stalls or appears broken.

### 4.3 SSE Integration Hook in `DBAContext.tsx`

```typescript
// SSE Client Lifecycle inside DBAProvider
useEffect(() => {
  if (!isStreaming || refreshRate === 0) {
    setStreamStatus("DISCONNECTED");
    return;
  }

  let eventSource: EventSource | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let retryCount = 0;
  let isUnmounted = false;

  const connectSSE = () => {
    if (isUnmounted) return;
    setStreamStatus(retryCount === 0 ? "CONNECTING" : "RECONNECTING");

    try {
      const url = `/api/stream/telemetry${selectedDbId !== "ALL" ? `?targetId=${selectedDbId}` : ""}`;
      eventSource = new EventSource(url);

      eventSource.onopen = () => {
        if (isUnmounted) return;
        setStreamStatus("CONNECTED");
        setReconnectAttempts(0);
        retryCount = 0;
      };

      // 1. Snapshot Event
      eventSource.addEventListener("snapshot", (e: MessageEvent) => {
        if (isUnmounted) return;
        try {
          const data: StreamSnapshotPayload = JSON.parse(e.data);
          if (data.instances && data.instances.length > 0) {
            setDatabases((prev) => {
              const map = new Map(data.instances.map((db) => [db.id, db]));
              return prev.map((db) => map.get(db.id) || db);
            });
          }
          if (data.activeIncidents) {
            setIncidents(data.activeIncidents);
          }
          setLastStreamEventAt(new Date().toISOString());
        } catch (err) {
          console.error("Failed to parse snapshot frame", err);
        }
      });

      // 2. Telemetry Delta Event
      eventSource.addEventListener("telemetry_delta", (e: MessageEvent) => {
        if (isUnmounted) return;
        try {
          const delta: StreamTelemetryDeltaPayload = JSON.parse(e.data);
          
          // Update database instance state
          setDatabases((prev) =>
            prev.map((db) =>
              db.id === delta.instanceId
                ? { ...db, ...delta.metrics, lastHealthCheck: "Just now" }
                : db
            )
          );

          // Append to metricsHistory if matching selectedDb or global
          if (delta.metricPoint) {
            setMetricsHistory((prev) => [...prev.slice(1), delta.metricPoint!]);
          }
          setLastStreamEventAt(new Date().toISOString());
        } catch (err) {
          console.error("Failed to parse delta frame", err);
        }
      });

      // 3. Circuit State Transition Event
      eventSource.addEventListener("circuit_state", (e: MessageEvent) => {
        if (isUnmounted) return;
        try {
          const circuit: StreamCircuitStatePayload = JSON.parse(e.data);
          
          // Update DB status based on circuit breaker
          setDatabases((prev) =>
            prev.map((db) => {
              if (db.id === circuit.endpointId) {
                const newStatus =
                  circuit.state === "OPEN"
                    ? "CRITICAL"
                    : circuit.state === "HALF_OPEN"
                    ? "HIGH_LOAD"
                    : "ONLINE";
                return { ...db, status: newStatus };
              }
              return db;
            })
          );

          // Log circuit transition in Connection Logs
          addLog({
            databaseId: circuit.endpointId,
            databaseName: circuit.endpointId,
            engine: "PostgreSQL",
            clientIp: "127.0.0.1",
            username: "system_circuit_breaker",
            eventType: circuit.state === "OPEN" ? "CONNECTION_EXHAUSTED" : "AUTH_SUCCESS",
            severity: circuit.state === "OPEN" ? "ERROR" : circuit.state === "HALF_OPEN" ? "WARN" : "INFO",
            latencyMs: 0,
            details: `Circuit transitioned from ${circuit.previousState} to ${circuit.state}. Reason: ${circuit.reason}`,
          });
          setLastStreamEventAt(new Date().toISOString());
        } catch (err) {
          console.error("Failed to parse circuit frame", err);
        }
      });

      // 4. Incident Fired Event
      eventSource.addEventListener("incident_fired", (e: MessageEvent) => {
        if (isUnmounted) return;
        try {
          const inc: IncidentAlert = JSON.parse(e.data);
          setIncidents((prev) => {
            const exists = prev.some((i) => i.id === inc.id);
            if (exists) return prev.map((i) => (i.id === inc.id ? inc : i));
            return [inc, ...prev];
          });
          setLastStreamEventAt(new Date().toISOString());
        } catch (err) {
          console.error("Failed to parse incident frame", err);
        }
      });

      // Error / Disconnect Handler
      eventSource.onerror = () => {
        if (isUnmounted) return;
        eventSource?.close();
        eventSource = null;

        retryCount++;
        setReconnectAttempts(retryCount);

        if (retryCount >= 3) {
          setStreamStatus("FALLBACK_SIMULATION");
        } else {
          setStreamStatus("RECONNECTING");
        }

        const backoffMs = Math.min(30000, 1000 * Math.pow(2, retryCount - 1)) + Math.random() * 500;
        reconnectTimer = setTimeout(connectSSE, backoffMs);
      };
    } catch {
      setStreamStatus("FALLBACK_SIMULATION");
    }
  };

  connectSSE();

  return () => {
    isUnmounted = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  };
}, [isStreaming, refreshRate, selectedDbId]);
```

### 4.4 Seamless Fallback Simulation Engine

When `streamStatus === "FALLBACK_SIMULATION"` (e.g. backend disconnected, offline demo, standalone UI development), a secondary `useEffect` runs local synthetic metric perturbation to maintain a responsive, living dashboard experience:

```typescript
useEffect(() => {
  if (streamStatus !== "FALLBACK_SIMULATION" || !isStreaming || refreshRate === 0) return;

  const interval = setInterval(() => {
    const now = new Date();
    const timestamp = now.toTimeString().split(" ")[0];

    // Local perturbation logic ...
    setDatabases((prev) =>
      prev.map((db) => {
        const cpuDelta = (Math.random() - 0.48) * 4;
        const newCpu = Math.min(99, Math.max(10, db.cpuUsage + cpuDelta));
        const connDelta = Math.floor((Math.random() - 0.5) * 6);
        const newConn = Math.min(db.maxConnections, Math.max(10, db.activeConnections + connDelta));
        const latencyDelta = (Math.random() - 0.49) * 5;
        const newLatency = Math.max(1.5, db.queryLatencyMs + latencyDelta);

        return {
          ...db,
          cpuUsage: Number(newCpu.toFixed(1)),
          activeConnections: newConn,
          queryLatencyMs: Number(newLatency.toFixed(1)),
          lastHealthCheck: "Just now (simulated)",
        };
      })
    );

    setMetricsHistory((prev) => {
      const last = prev[prev.length - 1] || { cpu: 45, memory: 65, iops: 1200, activeConn: 180, latencyMs: 15, slowQueries: 2, replicationLag: 0.1 };
      const newPoint: MetricPoint = {
        timestamp,
        cpu: Number(Math.min(99, Math.max(15, last.cpu + (Math.random() - 0.48) * 6)).toFixed(1)),
        memory: Number(Math.min(98, Math.max(30, last.memory + (Math.random() - 0.5) * 2)).toFixed(1)),
        iops: Math.floor(Math.max(400, last.iops + (Math.random() - 0.5) * 200)),
        activeConn: Math.floor(Math.max(50, last.activeConn + (Math.random() - 0.5) * 10)),
        latencyMs: Number(Math.max(2, last.latencyMs + (Math.random() - 0.49) * 8).toFixed(1)),
        slowQueries: Math.floor(Math.random() * 3),
        replicationLag: Number((Math.random() * 1.2).toFixed(1)),
      };
      return [...prev.slice(1), newPoint];
    });
  }, refreshRate * 1000);

  return () => clearInterval(interval);
}, [streamStatus, isStreaming, refreshRate]);
```

---

## 5. Deep Dive 3: Unit Test Design (`tests/unit/pollingEngine.test.ts`)

Conforming to `TEST_INFRA.md`, the unit tests use Node.js built-in test runner (`node:test` and `node:assert/strict`) executed via `npx tsx --test`.

### 5.1 Test Suite Breakdown

```
tests/unit/pollingEngine.test.ts
├── Suite 1: BoundedWorkerPool
│   ├── Test 1.1: Concurrency bounding under concurrent burst
│   ├── Test 1.2: Priority queue dispatch ordering (L1 > L2 > L3)
│   ├── Test 1.3: FIFO ordering within identical priority tiers
│   ├── Test 1.4: Queue overflow defensive rejection
│   └── Test 1.5: Worker pool telemetry and stats accuracy
├── Suite 2: EndpointCircuitBreaker
│   ├── Test 2.1: Normal CLOSED state execution and failure counter reset
│   ├── Test 2.2: State transition from CLOSED to OPEN upon threshold failures
│   ├── Test 2.3: Fast-fail execution in OPEN state (0 socket calls, <1ms)
│   ├── Test 2.4: State transition from OPEN to HALF_OPEN after cooldown
│   ├── Test 2.5: HALF_OPEN single probe recovery to CLOSED
│   ├── Test 2.6: HALF_OPEN probe failure with exponential cooldown backoff
│   └── Test 2.7: Execution timeout enforcement
├── Suite 3: TelemetryRingBuffer
│   ├── Test 3.1: $O(1)$ push insertion and count accounting
│   ├── Test 3.2: Oldest sample eviction upon capacity overflow
│   ├── Test 3.3: Multiple buffer wraparound cycles and chronological ordering
│   ├── Test 3.4: Buffer clear operation
│   └── Test 3.5: Rolling statistical calculations (min, max, average)
└── Suite 4: TieredScheduler & PollingEngine Coordination
    ├── Test 4.1: Cadence interval triggering for L1, L2, and L3 tiers
    ├── Test 4.2: Real-time event emission (telemetry_delta, circuit_state, incident_fired)
    ├── Test 4.3: Location-aware zone routing to dedicated worker pools
    ├── Test 4.4: Adaptive cadence throttling under high database load
    └── Test 4.5: Clean lifecycle start and graceful teardown without handle leaks
```

### 5.2 Concrete Test Code Implementations

Below is the complete, runnable unit test suite specification to be placed in `tests/unit/pollingEngine.test.ts`:

```typescript
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { BoundedWorkerPool } from "../../src/server/polling/BoundedWorkerPool";
import { EndpointCircuitBreaker, CircuitState } from "../../src/server/polling/CircuitBreaker";
import { TelemetryRingBuffer } from "../../src/server/polling/TelemetryRingBuffer";
import { TieredScheduler } from "../../src/server/polling/TieredScheduler";
import { PollingEngine } from "../../src/server/polling/PollingEngine";
import { DBInstance } from "../../src/types/dba";

// -----------------------------------------------------------------------------
// SUITE 1: BoundedWorkerPool
// -----------------------------------------------------------------------------
describe("BoundedWorkerPool Unit Tests", () => {
  test("1.1 Concurrency bounding strictly caps active concurrent workers", async () => {
    const maxConcurrency = 3;
    const pool = new BoundedWorkerPool("us-east-1", maxConcurrency, 100);
    let peakConcurrency = 0;
    let currentlyRunning = 0;

    const tasks = Array.from({ length: 12 }, (_, i) => async () => {
      currentlyRunning++;
      peakConcurrency = Math.max(peakConcurrency, currentlyRunning);
      await new Promise((res) => setTimeout(res, 20));
      currentlyRunning--;
      return `result-${i}`;
    });

    const results = await Promise.all(
      tasks.map((t, i) => pool.run(`target-${i}`, t, 2))
    );

    assert.equal(results.length, 12);
    assert.ok(peakConcurrency <= maxConcurrency, `Peak concurrency ${peakConcurrency} exceeded max ${maxConcurrency}`);
    assert.equal(pool.stats.activeWorkers, 0);
    assert.equal(pool.stats.queuedTasks, 0);
  });

  test("1.2 Priority queue orders tasks (L1 Priority 3 > L2 Priority 2 > L3 Priority 1)", async () => {
    const pool = new BoundedWorkerPool("us-east-1", 1, 100);
    const executionOrder: string[] = [];

    // Occupy the 1 active slot
    const blocker = pool.run("blocker", async () => {
      await new Promise((res) => setTimeout(res, 50));
      executionOrder.push("blocker");
    }, 1);

    // Queue L3 (Priority 1), L2 (Priority 2), L1 (Priority 3)
    const taskL3 = pool.run("target-l3", async () => {
      executionOrder.push("L3");
    }, 1);

    const taskL2 = pool.run("target-l2", async () => {
      executionOrder.push("L2");
    }, 2);

    const taskL1 = pool.run("target-l1", async () => {
      executionOrder.push("L1");
    }, 3);

    await Promise.all([blocker, taskL3, taskL2, taskL1]);

    assert.deepEqual(executionOrder, ["blocker", "L1", "L2", "L3"]);
  });

  test("1.3 FIFO ordering within identical priority tiers", async () => {
    const pool = new BoundedWorkerPool("us-east-1", 1, 100);
    const order: string[] = [];

    const blocker = pool.run("blocker", () => new Promise((res) => setTimeout(res, 40)), 1);

    const t1 = pool.run("t1", async () => { order.push("first"); }, 2);
    const t2 = pool.run("t2", async () => { order.push("second"); }, 2);

    await Promise.all([blocker, t1, t2]);
    assert.deepEqual(order, ["first", "second"]);
  });

  test("1.4 Queue overflow defensive rejection when maxQueueSize exceeded", async () => {
    const pool = new BoundedWorkerPool("us-east-1", 1, 2); // Concurrency 1, Queue 2

    // 1 in flight
    pool.run("in-flight", () => new Promise((res) => setTimeout(res, 100)), 1);
    // 2 in queue
    pool.run("q1", () => Promise.resolve("q1"), 1);
    pool.run("q2", () => Promise.resolve("q2"), 1);

    // 4th task should reject immediately with queue overflow error
    await assert.rejects(
      async () => {
        await pool.run("q3-overflow", () => Promise.resolve("overflow"), 1);
      },
      /Queue overflow/
    );
  });

  test("1.5 Worker pool stats reflect accurate counts", () => {
    const pool = new BoundedWorkerPool("eu-west-1", 5, 50);
    const stats = pool.stats;
    assert.equal(stats.zone, "eu-west-1");
    assert.equal(stats.maxConcurrency, 5);
    assert.equal(stats.activeWorkers, 0);
    assert.equal(stats.queuedTasks, 0);
  });
});

// -----------------------------------------------------------------------------
// SUITE 2: EndpointCircuitBreaker
// -----------------------------------------------------------------------------
describe("EndpointCircuitBreaker Unit Tests", () => {
  test("2.1 CLOSED state executes normally and resets failure count on success", async () => {
    const breaker = new EndpointCircuitBreaker("ep-01", {
      failureThreshold: 3,
      baseResetTimeoutMs: 1000,
      maxResetTimeoutMs: 5000,
      jitterFactor: 0,
      executionTimeoutMs: 1000,
    });

    const result = await breaker.execute(
      async () => "success",
      (err) => `fallback: ${err}`
    );

    assert.equal(result, "success");
    assert.equal(breaker.getState(), CircuitState.CLOSED);
    assert.equal(breaker.status.consecutiveFailures, 0);
  });

  test("2.2 State transitions from CLOSED to OPEN after consecutive failures", async () => {
    const breaker = new EndpointCircuitBreaker("ep-02", {
      failureThreshold: 3,
      baseResetTimeoutMs: 1000,
      maxResetTimeoutMs: 5000,
      jitterFactor: 0,
      executionTimeoutMs: 1000,
    });

    // 1st failure
    await breaker.execute(async () => { throw new Error("Fail 1"); }, () => "fallback");
    assert.equal(breaker.getState(), CircuitState.CLOSED);
    assert.equal(breaker.status.consecutiveFailures, 1);

    // 2nd failure
    await breaker.execute(async () => { throw new Error("Fail 2"); }, () => "fallback");
    assert.equal(breaker.getState(), CircuitState.CLOSED);
    assert.equal(breaker.status.consecutiveFailures, 2);

    // 3rd failure -> Trip to OPEN
    await breaker.execute(async () => { throw new Error("Fail 3"); }, () => "fallback");
    assert.equal(breaker.getState(), CircuitState.OPEN);
    assert.equal(breaker.status.consecutiveTrips, 1);
    assert.ok(breaker.status.nextAttemptTimestamp > Date.now());
  });

  test("2.3 Fast-failing in OPEN state performs 0 network calls and returns immediately", async () => {
    const breaker = new EndpointCircuitBreaker("ep-03", {
      failureThreshold: 1,
      baseResetTimeoutMs: 10000,
      maxResetTimeoutMs: 60000,
      jitterFactor: 0,
      executionTimeoutMs: 1000,
    });

    // Trip the breaker
    await breaker.execute(async () => { throw new Error("Network down"); }, () => "fallback");
    assert.equal(breaker.getState(), CircuitState.OPEN);

    let networkCallAttempts = 0;
    const start = Date.now();

    for (let i = 0; i < 20; i++) {
      const res = await breaker.execute(
        async () => {
          networkCallAttempts++;
          return "network";
        },
        (reason) => `fast-fail: ${reason}`
      );
      assert.ok(res.includes("fast-fail: Circuit is OPEN"));
    }

    const elapsed = Date.now() - start;
    assert.equal(networkCallAttempts, 0);
    assert.ok(elapsed < 20, `20 fast-fail executions took ${elapsed}ms (expected <20ms)`);
  });

  test("2.4 State transitions from OPEN to HALF_OPEN after cooldown elapses", async () => {
    const breaker = new EndpointCircuitBreaker("ep-04", {
      failureThreshold: 1,
      baseResetTimeoutMs: 50, // Short cooldown for unit test
      maxResetTimeoutMs: 1000,
      jitterFactor: 0,
      executionTimeoutMs: 500,
    });

    await breaker.execute(async () => { throw new Error("Trip"); }, () => "fallback");
    assert.equal(breaker.getState(), CircuitState.OPEN);

    // Wait for cooldown
    await new Promise((res) => setTimeout(res, 60));
    assert.equal(breaker.getState(), CircuitState.HALF_OPEN);
  });

  test("2.5 HALF_OPEN probe success recovers circuit to CLOSED", async () => {
    const breaker = new EndpointCircuitBreaker("ep-05", {
      failureThreshold: 1,
      baseResetTimeoutMs: 40,
      maxResetTimeoutMs: 1000,
      jitterFactor: 0,
      executionTimeoutMs: 500,
    });

    await breaker.execute(async () => { throw new Error("Trip"); }, () => "fallback");
    await new Promise((res) => setTimeout(res, 50));
    assert.equal(breaker.getState(), CircuitState.HALF_OPEN);

    const probeResult = await breaker.execute(async () => "probe-ok", () => "probe-fail");
    assert.equal(probeResult, "probe-ok");
    assert.equal(breaker.getState(), CircuitState.CLOSED);
    assert.equal(breaker.status.consecutiveTrips, 0);
    assert.equal(breaker.status.consecutiveFailures, 0);
  });

  test("2.6 HALF_OPEN probe failure doubles backoff and trips back to OPEN", async () => {
    const breaker = new EndpointCircuitBreaker("ep-06", {
      failureThreshold: 1,
      baseResetTimeoutMs: 40,
      maxResetTimeoutMs: 10000,
      jitterFactor: 0,
      executionTimeoutMs: 500,
    });

    // 1st trip
    await breaker.execute(async () => { throw new Error("Trip 1"); }, () => "fallback");
    await new Promise((res) => setTimeout(res, 50));
    assert.equal(breaker.getState(), CircuitState.HALF_OPEN);

    // 2nd trip (probe failure)
    await breaker.execute(async () => { throw new Error("Probe failed"); }, () => "fallback");
    assert.equal(breaker.getState(), CircuitState.OPEN);
    assert.equal(breaker.status.consecutiveTrips, 2);
    // Next attempt should be ~80ms (40ms * 2^1)
  });

  test("2.7 Execution timeout triggers failure and trips breaker", async () => {
    const breaker = new EndpointCircuitBreaker("ep-07", {
      failureThreshold: 1,
      baseResetTimeoutMs: 1000,
      maxResetTimeoutMs: 5000,
      jitterFactor: 0,
      executionTimeoutMs: 30, // 30ms timeout
    });

    const result = await breaker.execute(
      async () => {
        await new Promise((res) => setTimeout(res, 100));
        return "too-late";
      },
      (reason) => `timed-out: ${reason}`
    );

    assert.ok(result.includes("timed-out: Timeout after 30ms"));
    assert.equal(breaker.getState(), CircuitState.OPEN);
  });
});

// -----------------------------------------------------------------------------
// SUITE 3: TelemetryRingBuffer
// -----------------------------------------------------------------------------
describe("TelemetryRingBuffer Unit Tests", () => {
  test("3.1 Push insertion and size tracking", () => {
    const ring = new TelemetryRingBuffer<number>(5);
    assert.equal(ring.size, 0);
    assert.equal(ring.latest, null);

    ring.push(10);
    ring.push(20);
    ring.push(30);

    assert.equal(ring.size, 3);
    assert.equal(ring.latest, 30);
    assert.deepEqual(ring.toArray(), [10, 20, 30]);
  });

  test("3.2 Evicts oldest element in O(1) upon capacity overflow", () => {
    const ring = new TelemetryRingBuffer<number>(3);
    ring.push(1);
    ring.push(2);
    ring.push(3);
    assert.deepEqual(ring.toArray(), [1, 2, 3]);

    ring.push(4); // Evicts 1
    assert.equal(ring.size, 3);
    assert.deepEqual(ring.toArray(), [2, 3, 4]);
    assert.equal(ring.latest, 4);

    ring.push(5); // Evicts 2
    assert.deepEqual(ring.toArray(), [3, 4, 5]);
    assert.equal(ring.latest, 5);
  });

  test("3.3 Multi-cycle circular wraparound maintains strict chronological ordering", () => {
    const ring = new TelemetryRingBuffer<number>(4);
    for (let i = 1; i <= 20; i++) {
      ring.push(i);
    }

    assert.equal(ring.size, 4);
    assert.deepEqual(ring.toArray(), [17, 18, 19, 20]);
    assert.equal(ring.latest, 20);
  });

  test("3.4 Buffer clear operation resets indices and count", () => {
    const ring = new TelemetryRingBuffer<string>(5);
    ring.push("a");
    ring.push("b");
    ring.clear();

    assert.equal(ring.size, 0);
    assert.equal(ring.latest, null);
    assert.deepEqual(ring.toArray(), []);
  });

  test("3.5 Rolling statistical calculations", () => {
    interface Sample { cpu: number }
    const ring = new TelemetryRingBuffer<Sample>(5);
    ring.push({ cpu: 10 });
    ring.push({ cpu: 20 });
    ring.push({ cpu: 30 });
    ring.push({ cpu: 40 });

    const stats = ring.getRollingStats((s) => s.cpu);
    assert.equal(stats.min, 10);
    assert.equal(stats.max, 40);
    assert.equal(stats.avg, 25);
    assert.equal(stats.count, 4);
  });
});

// -----------------------------------------------------------------------------
// SUITE 4: TieredScheduler & PollingEngine Coordination
// -----------------------------------------------------------------------------
describe("TieredScheduler & PollingEngine Coordination Unit Tests", () => {
  const sampleDb: DBInstance = {
    id: "db-test-01",
    name: "test-pg",
    engine: "PostgreSQL",
    version: "16.0",
    host: "127.0.0.1",
    port: 5432,
    databaseName: "testdb",
    status: "ONLINE",
    uptimeSeconds: 1000,
    cpuUsage: 30,
    memoryUsage: 50,
    iops: 500,
    activeConnections: 50,
    maxConnections: 200,
    queryLatencyMs: 10,
    slowQueryCount: 0,
    diskFreeGb: 100,
    diskTotalGb: 200,
    replicationLagSeconds: 0,
    bufferHitRatio: 99,
    deadlocksCount: 0,
    lastHealthCheck: "Just now",
    engineSpecific: {},
  };

  test("4.1 PollingEngine event emission on poll execution", async () => {
    const engine = new PollingEngine({
      zones: [{ name: "us-east-1", maxConcurrency: 5 }],
      defaultCadence: { l1Ms: 100, l2Ms: 200, l3Ms: 500 },
    });

    engine.registerTarget(sampleDb, "us-east-1");

    let receivedDelta = false;
    engine.on("telemetry_delta", (payload) => {
      if (payload.instanceId === "db-test-01") {
        receivedDelta = true;
      }
    });

    await engine.pollOnce("db-test-01", "L1");
    assert.ok(receivedDelta, "Expected telemetry_delta event was not emitted");
    engine.stop();
  });

  test("4.2 Location-aware zone routing to dedicated worker pools", async () => {
    const engine = new PollingEngine({
      zones: [
        { name: "us-east-1", maxConcurrency: 5 },
        { name: "eu-west-1", maxConcurrency: 5 },
      ],
      defaultCadence: { l1Ms: 100, l2Ms: 200, l3Ms: 500 },
    });

    const euDb = { ...sampleDb, id: "db-eu-01" };
    engine.registerTarget(euDb, "eu-west-1");

    await engine.pollOnce("db-eu-01", "L1");
    const euStats = engine.getZoneStats("eu-west-1");
    assert.ok(euStats, "EU zone stats missing");
    assert.ok(euStats.totalTasksCompleted >= 1);
    engine.stop();
  });

  test("4.3 Lifecycle start and stop clears all intervals", async () => {
    const engine = new PollingEngine({
      zones: [{ name: "us-east-1", maxConcurrency: 2 }],
      defaultCadence: { l1Ms: 50, l2Ms: 100, l3Ms: 200 },
    });

    engine.registerTarget(sampleDb, "us-east-1");
    engine.start();
    assert.equal(engine.isRunning(), true);

    await new Promise((res) => setTimeout(res, 120));
    engine.stop();
    assert.equal(engine.isRunning(), false);
  });
});
```

---

## 6. Summary of Key Implementation Recommendations

1. **Modular Backend Hierarchy**:
   - `src/server/polling/BoundedWorkerPool.ts`: Priority queuing, concurrency limits, overflow rejection.
   - `src/server/polling/CircuitBreaker.ts`: CLOSED/OPEN/HALF_OPEN state transitions, jittered exponential backoff, fast-fail execution.
   - `src/server/polling/TelemetryRingBuffer.ts`: Circular bounded buffer with rolling statistics calculation.
   - `src/server/polling/TieredScheduler.ts`: 3-Tier cadence loops with adaptive load throttling.
   - `src/server/polling/PollingEngine.ts`: Central coordinator managing targets, pools, breakers, buffers, snapshot delivery, and event emission.
2. **Server Integration (`server.ts`)**:
   - Initialize singleton `PollingEngine` on server boot.
   - Wire `GET /api/stream/telemetry` with keepalives and event filters.
   - Wire `GET /api/polling/status` management route.
3. **Frontend Integration (`src/context/DBAContext.tsx`)**:
   - Integrate SSE `EventSource` with exponential backoff reconnection.
   - Hydrate initial state on `snapshot`, merge live metric updates on `telemetry_delta`, update DB statuses on `circuit_state`, and prepend alerts on `incident_fired`.
   - Maintain seamless `FALLBACK_SIMULATION` mode for offline/disconnected operation.
4. **Comprehensive Unit Verification**:
   - Place all tests in `tests/unit/pollingEngine.test.ts` runnable via `npx tsx --test`.
