export type DatabaseEngine = "PostgreSQL" | "SQL Server" | "MySQL" | "Oracle";

export type IncidentSeverity = "CRITICAL" | "WARNING" | "INFO";
export type IncidentStatus = "FIRING" | "ACKNOWLEDGED" | "RESOLVED" | "SILENCED";

export type RoleType = "SUPER_ADMIN" | "SENIOR_DBA" | "JUNIOR_DBA" | "AUDITOR";

export interface DBInstance {
  id: string;
  name: string;
  engine: DatabaseEngine;
  version: string;
  host: string;
  port: number;
  databaseName: string;
  status: "ONLINE" | "HIGH_LOAD" | "CRITICAL" | "MAINTENANCE";
  uptimeSeconds: number;
  cpuUsage: number; // percentage
  memoryUsage: number; // percentage
  iops: number;
  activeConnections: number;
  maxConnections: number;
  queryLatencyMs: number;
  slowQueryCount: number;
  diskFreeGb: number;
  diskTotalGb: number;
  replicationLagSeconds: number;
  bufferHitRatio: number; // percentage
  deadlocksCount: number;
  lastHealthCheck: string;
  // Engine specific metrics
  engineSpecific: {
    // PostgreSQL
    autovacuumRunning?: boolean;
    walSizeMb?: number;
    idleInTransaction?: number;
    // SQL Server
    tempDbContentionPct?: number;
    pageLifeExpectancySec?: number;
    batchRequestsPerSec?: number;
    // MySQL
    innodbBufferHitRatio?: number;
    threadsConnected?: number;
    tableLocksWaiting?: number;
  };
}

export interface MetricPoint {
  timestamp: string; // HH:mm:ss or ISO
  cpu: number;
  memory: number;
  iops: number;
  activeConn: number;
  latencyMs: number;
  slowQueries: number;
  replicationLag: number;
}

export interface ThresholdRule {
  id: string;
  name: string;
  databaseId: string | "ALL";
  metricName: "CPU" | "MEMORY" | "LATENCY" | "CONNECTIONS" | "DISK_SPACE" | "REPLICATION_LAG";
  operator: ">" | ">=" | "<" | "<=";
  warningThreshold: number;
  criticalThreshold: number;
  durationSeconds: number;
  enabled: boolean;
  notificationChannels: string[];
  description: string;
}

export interface IncidentAlert {
  id: string;
  ruleId: string;
  databaseId: string;
  databaseName: string;
  engine: DatabaseEngine;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  currentValue: number;
  thresholdValue: number;
  unit: string;
  firedAt: string;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  notes?: string;
  remediationScript?: string;
}

export interface ConnectionLog {
  id: string;
  timestamp: string;
  databaseId: string;
  databaseName: string;
  engine: DatabaseEngine;
  clientIp: string;
  username: string;
  eventType:
    | "AUTH_SUCCESS"
    | "AUTH_FAILURE"
    | "CONNECTION_EXHAUSTED"
    | "SSL_HANDSHAKE_ERROR"
    | "QUERY_TIMEOUT"
    | "MAX_IDLE_TIMEOUT";
  severity: "INFO" | "WARN" | "ERROR";
  latencyMs: number;
  querySummary?: string;
  details?: string;
}

export interface UserPermission {
  canViewMetrics: boolean;
  canEditThresholds: boolean;
  canExecuteRemediation: boolean;
  canManageCredentials: boolean;
  canManageUsers: boolean;
  canExportReports: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: RoleType;
  department: string;
  lastLogin: string;
  status: "ACTIVE" | "INACTIVE";
  permissions: UserPermission;
}

export interface NotificationChannel {
  id: string;
  name: string;
  type: "EMAIL" | "WEBHOOK" | "SLACK" | "PAGERDUTY";
  target: string; // email address or webhook URL
  enabled: boolean;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  bodyHtml: string;
  isDefault: boolean;
}

export interface DashboardWidgetConfig {
  id: string;
  title: string;
  type:
    | "METRIC_GAUGE"
    | "LATENCY_CHART"
    | "CONNECTIONS_CHART"
    | "LOGS_STREAM"
    | "ENGINE_SPECIFIC"
    | "INCIDENT_BANNER"
    | "SLA_HEALTH";
  visible: boolean;
  width: "FULL" | "HALF" | "THIRD";
}

export interface DashboardPreset {
  id: string;
  name: string;
  description: string;
  widgets: DashboardWidgetConfig[];
}

export interface PDFReportConfig {
  reportTitle: string;
  subtitle: string;
  includeMetricsSummary: boolean;
  includeIncidentBreakdown: boolean;
  includeConnectionLogs: boolean;
  includeEngineHealth: boolean;
  timeRange: "24h" | "7d" | "30d";
  preparedBy: string;
  customNotes: string;
}
