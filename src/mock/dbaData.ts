import {
  DBInstance,
  MetricPoint,
  ThresholdRule,
  IncidentAlert,
  ConnectionLog,
  User,
  NotificationChannel,
  EmailTemplate,
  DashboardPreset,
} from "../types/dba";

export const INITIAL_DATABASES: DBInstance[] = [
  {
    id: "db-pg-01",
    name: "pg-prod-primary-eu",
    engine: "PostgreSQL",
    version: "PostgreSQL 16.2 (Debian 16.2-1.pgdg120+1)",
    host: "pg-primary.prod.internal",
    port: 5432,
    databaseName: "customer_orders_db",
    status: "ONLINE",
    uptimeSeconds: 1420500,
    cpuUsage: 42.5,
    memoryUsage: 68.1,
    iops: 1240,
    activeConnections: 184,
    maxConnections: 300,
    queryLatencyMs: 14.2,
    slowQueryCount: 3,
    diskFreeGb: 142.5,
    diskTotalGb: 500.0,
    replicationLagSeconds: 0.2,
    bufferHitRatio: 99.4,
    deadlocksCount: 0,
    lastHealthCheck: "Just now",
    engineSpecific: {
      autovacuumRunning: true,
      walSizeMb: 1280,
      idleInTransaction: 2,
    },
  },
  {
    id: "db-mssql-01",
    name: "sql-fin-analytics-us",
    engine: "SQL Server",
    version: "Microsoft SQL Server 2022 (RTM-CU12) Standard Edition",
    host: "sql-finance.us-east.db.net",
    port: 1433,
    databaseName: "Ledger_Transactions_2026",
    status: "HIGH_LOAD",
    uptimeSeconds: 894000,
    cpuUsage: 89.2,
    memoryUsage: 84.7,
    iops: 3890,
    activeConnections: 412,
    maxConnections: 500,
    queryLatencyMs: 185.0,
    slowQueryCount: 18,
    diskFreeGb: 48.2,
    diskTotalGb: 1000.0,
    replicationLagSeconds: 4.8,
    bufferHitRatio: 94.1,
    deadlocksCount: 4,
    lastHealthCheck: "Just now",
    engineSpecific: {
      tempDbContentionPct: 24.8,
      pageLifeExpectancySec: 1450,
      batchRequestsPerSec: 12800,
    },
  },
  {
    id: "db-mysql-01",
    name: "mysql-userauth-asia",
    engine: "MySQL",
    version: "8.0.36 MySQL Community Server - GPL",
    host: "mysql-auth-sg.asia.cloud.internal",
    port: 3306,
    databaseName: "auth_sessions_v2",
    status: "ONLINE",
    uptimeSeconds: 3120000,
    cpuUsage: 31.0,
    memoryUsage: 54.2,
    iops: 820,
    activeConnections: 92,
    maxConnections: 250,
    queryLatencyMs: 8.5,
    slowQueryCount: 1,
    diskFreeGb: 280.0,
    diskTotalGb: 400.0,
    replicationLagSeconds: 0.0,
    bufferHitRatio: 98.9,
    deadlocksCount: 0,
    lastHealthCheck: "Just now",
    engineSpecific: {
      innodbBufferHitRatio: 98.9,
      threadsConnected: 92,
      tableLocksWaiting: 0,
    },
  },
  {
    id: "db-pg-02",
    name: "pg-analytics-warehouse",
    engine: "PostgreSQL",
    version: "PostgreSQL 15.6 on x86_64-pc-linux-gnu",
    host: "dw-pg.internal.corp",
    port: 5432,
    databaseName: "data_warehouse_bi",
    status: "CRITICAL",
    uptimeSeconds: 61200,
    cpuUsage: 96.4,
    memoryUsage: 91.2,
    iops: 5400,
    activeConnections: 288,
    maxConnections: 300,
    queryLatencyMs: 2450.0,
    slowQueryCount: 42,
    diskFreeGb: 12.0,
    diskTotalGb: 800.0,
    replicationLagSeconds: 42.0,
    bufferHitRatio: 88.2,
    deadlocksCount: 11,
    lastHealthCheck: "Just now",
    engineSpecific: {
      autovacuumRunning: false,
      walSizeMb: 18400,
      idleInTransaction: 14,
    },
  },
];

export const INITIAL_METRIC_HISTORY: MetricPoint[] = Array.from({ length: 20 }, (_, i) => {
  const t = new Date(Date.now() - (19 - i) * 15 * 1000);
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  const ss = String(t.getSeconds()).padStart(2, "0");

  return {
    timestamp: `${hh}:${mm}:${ss}`,
    cpu: Math.floor(35 + Math.random() * 25 + (i > 15 ? 30 : 0)),
    memory: Math.floor(60 + Math.random() * 15),
    iops: Math.floor(1000 + Math.random() * 1500),
    activeConn: Math.floor(120 + Math.random() * 80),
    latencyMs: Number((10 + Math.random() * 25 + (i > 16 ? 120 : 0)).toFixed(1)),
    slowQueries: Math.floor(Math.random() * 4 + (i > 15 ? 8 : 0)),
    replicationLag: Number((Math.random() * 1.5).toFixed(1)),
  };
});

export const INITIAL_THRESHOLDS: ThresholdRule[] = [
  {
    id: "thresh-01",
    name: "Critical CPU Utilization (> 85%)",
    databaseId: "ALL",
    metricName: "CPU",
    operator: ">",
    warningThreshold: 75,
    criticalThreshold: 85,
    durationSeconds: 120,
    enabled: true,
    notificationChannels: ["chan-email-dba", "chan-slack-incidents"],
    description: "Triggers when sustained CPU usage across any database instance exceeds 85% for 2 minutes.",
  },
  {
    id: "thresh-02",
    name: "High Query Latency (> 2000ms)",
    databaseId: "ALL",
    metricName: "LATENCY",
    operator: ">",
    warningThreshold: 1000,
    criticalThreshold: 2000,
    durationSeconds: 60,
    enabled: true,
    notificationChannels: ["chan-email-dba", "chan-pagerduty"],
    description: "Alerts DBAs when mean query execution latency spikes over 2 seconds.",
  },
  {
    id: "thresh-03",
    name: "Connection Pool Exhaustion (> 90%)",
    databaseId: "ALL",
    metricName: "CONNECTIONS",
    operator: ">=",
    warningThreshold: 80,
    criticalThreshold: 90,
    durationSeconds: 30,
    enabled: true,
    notificationChannels: ["chan-email-dba"],
    description: "Fires when active database connections reach 90% of max_connections limit.",
  },
  {
    id: "thresh-04",
    name: "Low Disk Space (< 15% Free)",
    databaseId: "ALL",
    metricName: "DISK_SPACE",
    operator: "<=",
    warningThreshold: 20,
    criticalThreshold: 15,
    durationSeconds: 300,
    enabled: true,
    notificationChannels: ["chan-email-dba"],
    description: "Fires when available disk storage drops below 15% to prevent database panic shutdown.",
  },
  {
    id: "thresh-05",
    name: "Replication Lag (> 30s)",
    databaseId: "db-pg-02",
    metricName: "REPLICATION_LAG",
    operator: ">",
    warningThreshold: 10,
    criticalThreshold: 30,
    durationSeconds: 60,
    enabled: true,
    notificationChannels: ["chan-email-dba", "chan-slack-incidents"],
    description: "Monitors read replica synchronization delay from primary PostgreSQL node.",
  },
];

export const INITIAL_INCIDENTS: IncidentAlert[] = [
  {
    id: "inc-1001",
    ruleId: "thresh-01",
    databaseId: "db-pg-02",
    databaseName: "pg-analytics-warehouse",
    engine: "PostgreSQL",
    title: "CPU Utilization Critical (96.4%)",
    severity: "CRITICAL",
    status: "FIRING",
    currentValue: 96.4,
    thresholdValue: 85.0,
    unit: "%",
    firedAt: new Date(Date.now() - 14 * 60 * 1000).toISOString(),
    notes: "High sequential scan on analytics_events partition table during ETL batch run.",
    remediationScript: "SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE query LIKE '%SELECT * FROM analytics_events%' AND age(clock_timestamp(), query_start) > interval '5 minutes';",
  },
  {
    id: "inc-1002",
    ruleId: "thresh-02",
    databaseId: "db-mssql-01",
    databaseName: "sql-fin-analytics-us",
    engine: "SQL Server",
    title: "TempDB Latch & CPU Contention Warning",
    severity: "WARNING",
    status: "ACKNOWLEDGED",
    currentValue: 89.2,
    thresholdValue: 75.0,
    unit: "%",
    firedAt: new Date(Date.now() - 42 * 60 * 1000).toISOString(),
    acknowledgedBy: "Saker Kadri (Lead DBA)",
    acknowledgedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    notes: "TempDB allocation contention on PAGELATCH_UP. Adding 4 additional TempDB data files.",
  },
  {
    id: "inc-1003",
    ruleId: "thresh-05",
    databaseId: "db-pg-02",
    databaseName: "pg-analytics-warehouse",
    engine: "PostgreSQL",
    title: "PostgreSQL Replication Lag Exceeds 42s",
    severity: "CRITICAL",
    status: "FIRING",
    currentValue: 42.0,
    thresholdValue: 30.0,
    unit: "sec",
    firedAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
    notes: "WAL sender bandwidth throttled due to large transaction commit.",
    remediationScript: "ALTER SYSTEM SET max_wal_senders = 10; SELECT pg_reload_conf();",
  },
];

export const INITIAL_CONNECTION_LOGS: ConnectionLog[] = [
  {
    id: "log-8001",
    timestamp: "10:57:12",
    databaseId: "db-pg-01",
    databaseName: "pg-prod-primary-eu",
    engine: "PostgreSQL",
    clientIp: "10.240.12.84",
    username: "app_orders_rw",
    eventType: "AUTH_SUCCESS",
    severity: "INFO",
    latencyMs: 3.2,
    details: "TLSv1.3 AES_256_GCM connection pool acquire",
  },
  {
    id: "log-8002",
    timestamp: "10:56:45",
    databaseId: "db-mssql-01",
    databaseName: "sql-fin-analytics-us",
    engine: "SQL Server",
    clientIp: "192.168.4.112",
    username: "reporting_svc",
    eventType: "QUERY_TIMEOUT",
    severity: "WARN",
    latencyMs: 15020.0,
    querySummary: "EXEC sp_GetQuarterlyLedgerSummary @Year=2026, @DeptID=44",
    details: "Query cancelled due to 15s execution timeout constraint",
  },
  {
    id: "log-8003",
    timestamp: "10:55:20",
    databaseId: "db-pg-02",
    databaseName: "pg-analytics-warehouse",
    engine: "PostgreSQL",
    clientIp: "172.16.88.19",
    username: "unknown_client",
    eventType: "AUTH_FAILURE",
    severity: "ERROR",
    latencyMs: 12.4,
    details: "FATAL: password authentication failed for user 'unknown_client' - IP blocked for 5m",
  },
  {
    id: "log-8004",
    timestamp: "10:54:10",
    databaseId: "db-mysql-01",
    databaseName: "mysql-userauth-asia",
    engine: "MySQL",
    clientIp: "10.128.0.45",
    username: "auth_service",
    eventType: "AUTH_SUCCESS",
    severity: "INFO",
    latencyMs: 2.1,
    details: "Handshake finished over TLSv1.2",
  },
  {
    id: "log-8005",
    timestamp: "10:52:30",
    databaseId: "db-pg-02",
    databaseName: "pg-analytics-warehouse",
    engine: "PostgreSQL",
    clientIp: "10.240.15.201",
    username: "bi_etl_worker",
    eventType: "CONNECTION_EXHAUSTED",
    severity: "ERROR",
    latencyMs: 104.0,
    details: "FATAL: sorry, too many clients already (max_connections = 300 reached)",
  },
  {
    id: "log-8006",
    timestamp: "10:50:18",
    databaseId: "db-mssql-01",
    databaseName: "sql-fin-analytics-us",
    engine: "SQL Server",
    clientIp: "192.168.4.99",
    username: "sa_admin",
    eventType: "SSL_HANDSHAKE_ERROR",
    severity: "WARN",
    latencyMs: 45.0,
    details: "Client certificate verification expired or untrusted authority",
  },
];

export const INITIAL_USERS: User[] = [
  {
    id: "usr-01",
    name: "Saker Kadri",
    email: "saker.kadri@gmail.com",
    avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150",
    role: "SUPER_ADMIN",
    department: "Principal Database Engineering",
    lastLogin: "Active Now",
    status: "ACTIVE",
    permissions: {
      canViewMetrics: true,
      canEditThresholds: true,
      canExecuteRemediation: true,
      canManageCredentials: true,
      canManageUsers: true,
      canExportReports: true,
    },
  },
  {
    id: "usr-02",
    name: "Elena Rostova",
    email: "elena.r@datapulse.io",
    avatar: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=150",
    role: "SENIOR_DBA",
    department: "Infrastructure Reliability",
    lastLogin: "2 hours ago",
    status: "ACTIVE",
    permissions: {
      canViewMetrics: true,
      canEditThresholds: true,
      canExecuteRemediation: true,
      canManageCredentials: false,
      canManageUsers: false,
      canExportReports: true,
    },
  },
  {
    id: "usr-03",
    name: "Marcus Vance",
    email: "marcus.vance@datapulse.io",
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=150",
    role: "JUNIOR_DBA",
    department: "L1 NOC Operations",
    lastLogin: "Yesterday",
    status: "ACTIVE",
    permissions: {
      canViewMetrics: true,
      canEditThresholds: false,
      canExecuteRemediation: false,
      canManageCredentials: false,
      canManageUsers: false,
      canExportReports: true,
    },
  },
  {
    id: "usr-04",
    name: "David Chen",
    email: "david.chen@audit-corp.com",
    avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=150",
    role: "AUDITOR",
    department: "SOC2 Compliance & Security",
    lastLogin: "3 days ago",
    status: "ACTIVE",
    permissions: {
      canViewMetrics: true,
      canEditThresholds: false,
      canExecuteRemediation: false,
      canManageCredentials: false,
      canManageUsers: false,
      canExportReports: true,
    },
  },
];

export const INITIAL_CHANNELS: NotificationChannel[] = [
  {
    id: "chan-email-dba",
    name: "DBA Incident On-Call Email",
    type: "EMAIL",
    target: "dba-alerts@company.com",
    enabled: true,
  },
  {
    id: "chan-slack-incidents",
    name: "#dba-alerts-critical (Slack)",
    type: "SLACK",
    target: "https://hooks.slack.com/services/T00/B00/XXXX",
    enabled: true,
  },
  {
    id: "chan-pagerduty",
    name: "PagerDuty Tier 1 On-Call",
    type: "PAGERDUTY",
    target: "pd-svc-key-7492019a",
    enabled: true,
  },
];

export const INITIAL_EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: "tpl-critical-incident",
    name: "Critical Database Outage Alert",
    subject: "🚨 CRITICAL INCIDENT [{{severity}}]: {{database_name}} - {{incident_title}}",
    bodyHtml: `<div style="font-family: Arial, sans-serif; padding: 20px; background-color: #0f172a; color: #f8fafc; border-radius: 8px;">
  <div style="border-bottom: 2px solid #ef4444; padding-bottom: 12px; margin-bottom: 16px;">
    <h2 style="color: #ef4444; margin: 0;">🚨 DataPulse Critical Incident Alert</h2>
    <p style="color: #94a3b8; font-size: 13px; margin: 4px 0 0 0;">Incident ID: {{incident_id}} | Engine: {{engine}}</p>
  </div>
  
  <p>An automated health monitor triggered a <strong>{{severity}}</strong> alert for instance <code>{{database_name}}</code>.</p>
  
  <table style="width: 100%; border-collapse: collapse; margin: 16px 0; background: #1e293b; border-radius: 6px; overflow: hidden;">
    <tr style="border-bottom: 1px solid #334155;">
      <td style="padding: 10px; color: #94a3b8;">Metric Fired:</td>
      <td style="padding: 10px; font-weight: bold; color: #f8fafc;">{{metric_name}}</td>
    </tr>
    <tr style="border-bottom: 1px solid #334155;">
      <td style="padding: 10px; color: #94a3b8;">Current Value:</td>
      <td style="padding: 10px; font-weight: bold; color: #ef4444;">{{current_value}} {{unit}}</td>
    </tr>
    <tr style="border-bottom: 1px solid #334155;">
      <td style="padding: 10px; color: #94a3b8;">Threshold Breach:</td>
      <td style="padding: 10px; font-weight: bold; color: #f59e0b;">{{threshold_value}} {{unit}}</td>
    </tr>
    <tr>
      <td style="padding: 10px; color: #94a3b8;">Fired At:</td>
      <td style="padding: 10px; color: #f8fafc;">{{fired_at}}</td>
    </tr>
  </table>

  <div style="background: #090d16; padding: 12px; border-left: 4px solid #3b82f6; border-radius: 4px; margin: 16px 0;">
    <strong style="color: #60a5fa;">DBA Incident Notes / Context:</strong>
    <p style="margin: 6px 0 0 0; color: #cbd5e1; font-size: 13px;">{{notes}}</p>
  </div>

  <div style="margin-top: 24px; text-align: center;">
    <a href="{{app_url}}" style="background: #ef4444; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; display: inline-block;">Open Incident Room & Acknowledge</a>
  </div>
</div>`,
    isDefault: true,
  },
];

export const INITIAL_DASHBOARD_PRESETS: DashboardPreset[] = [
  {
    id: "preset-default",
    name: "Primary DBA Command Center",
    description: "Balanced overview of all connected PostgreSQL, SQL Server, and MySQL database engines.",
    widgets: [
      { id: "w-01", title: "Active Incident Banner", type: "INCIDENT_BANNER", visible: true, width: "FULL" },
      { id: "w-02", title: "Database Fleet Health & Latency", type: "METRIC_GAUGE", visible: true, width: "FULL" },
      { id: "w-03", title: "Real-time Query Latency Stream", type: "LATENCY_CHART", visible: true, width: "HALF" },
      { id: "w-04", title: "Active Connections vs Pool Limit", type: "CONNECTIONS_CHART", visible: true, width: "HALF" },
      { id: "w-05", title: "Engine Deep-Dive (Postgres / SQL Server / MySQL)", type: "ENGINE_SPECIFIC", visible: true, width: "FULL" },
      { id: "w-06", title: "Live Database Connection Logs", type: "LOGS_STREAM", visible: true, width: "FULL" },
    ],
  },
  {
    id: "preset-emergency",
    name: "Incident Response & Outage War Room",
    description: "Focuses strictly on critical alerts, firing threshold breaches, and real-time slow query logs.",
    widgets: [
      { id: "w-01", title: "Active Incident Banner", type: "INCIDENT_BANNER", visible: true, width: "FULL" },
      { id: "w-03", title: "Real-time Query Latency Stream", type: "LATENCY_CHART", visible: true, width: "HALF" },
      { id: "w-06", title: "Live Database Connection Logs", type: "LOGS_STREAM", visible: true, width: "HALF" },
      { id: "w-02", title: "Database Fleet Health & Latency", type: "METRIC_GAUGE", visible: true, width: "FULL" },
    ],
  },
  {
    id: "preset-security",
    name: "Security, Auth & Connection Audit",
    description: "Monitors connection failures, SSL handshake errors, and user access trails.",
    widgets: [
      { id: "w-06", title: "Live Database Connection Logs", type: "LOGS_STREAM", visible: true, width: "FULL" },
      { id: "w-04", title: "Active Connections vs Pool Limit", type: "CONNECTIONS_CHART", visible: true, width: "HALF" },
      { id: "w-07", title: "SLA & Uptime Gauge", type: "SLA_HEALTH", visible: true, width: "HALF" },
    ],
  },
];
