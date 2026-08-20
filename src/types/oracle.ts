/**
 * Oracle Database Monitoring Types & Data Contracts
 * Path: src/types/oracle.ts
 */

export type OracleOpenMode =
  | "READ WRITE"
  | "READ ONLY"
  | "MOUNTED"
  | "MIGRATE"
  | "READ WRITE (RESTRICTED)";

export type OracleWaitClassName =
  | "System I/O"
  | "Concurrency"
  | "Commit"
  | "Application"
  | "Configuration"
  | "User I/O"
  | "Network"
  | "Administrative"
  | "Other"
  | "Idle";

export type OracleASMRedundancy = "HIGH" | "NORMAL" | "EXTERN" | "FLEX";

export type ProcessStatus = "RUNNING" | "STOPPED" | "DEGRADED";

export interface OraclePDBMetrics {
  conId: number;
  pdbName: string;
  openMode: OracleOpenMode;
  restricted: boolean;
  totalSizeGb: number;
  usedSizeGb: number;
  activeSessions: number;
  totalSessions: number;
  cpuSlicePct: number; // % of container CPU consumed by this PDB (V$RSRC_PDB_METRIC)
  cpuSecondsUsed: number;
  cpuWaitingSec?: number;
  avgWaitingSessions?: number;
  iops?: number;
  iombps?: number;
  tablespaceCount: number;
  autoextendHeadroomGb: number;
  recoveryStatus: "ENABLED" | "DISABLED" | "RESTRICTED";
}

export interface OracleSGAMetrics {
  totalSgaMb: number;
  bufferCacheMb: number;
  sharedPoolMb: number;
  largePoolMb: number;
  javaPoolMb: number;
  redoBufferMb: number;
  streamsPoolMb?: number;
  freeSgaMb: number;
  bufferCacheHitRatio: number; // e.g. 98.6%
  sharedPoolFreePct: number;
  dictionaryCacheHitRatio: number;
  libraryCacheHitRatio: number;
}

export interface OraclePGAMetrics {
  pgaTargetMb: number;
  pgaAllocatedMb: number;
  pgaInUseMb: number;
  pgaFreeableMb: number;
  pgaCacheHitRatio: number; // %
  autoPgaEnabled: boolean;
  overAllocationCount: number;
}

export interface OracleRedoSwitchHour {
  hour: string; // e.g. "00:00", "01:00", ... "23:00"
  switchCount: number;
  avgDurationMinutes: number;
  isSpike: boolean; // switchCount > 6
}

export interface OracleRedoLogMetrics {
  currentLogSequence: number;
  redoLogGroups: number;
  redoLogMemberSizeMb: number;
  avgSwitchesPerHour: number;
  currentSwitchRatePerHour: number;
  switchesLastHour: number;
  switchesLast6h: number;
  switchesLast24h: number;
  lastSwitchTime?: string;
  lgwrLatencyMs: number;
  checkpointLagSec?: number;
  last24HoursHistory: OracleRedoSwitchHour[];
}

export interface OracleASMDiskgroup {
  groupNumber: number;
  name: string; // e.g. "+DATA", "+RECO", "+FRA"
  state: "MOUNTED" | "DISMOUNTED" | "CONNECTED" | "BROKEN";
  type: OracleASMRedundancy;
  totalMb: number;
  freeMb: number;
  usableFileMb: number; // Usable free file space considering mirror redundancy
  usedPct: number;
  freePct: number;
  offlineDisks: number;
  totalDisks: number;
  votingFiles: boolean;
  auSizeMb: number;
}

export interface OracleWaitEvent {
  event: string; // e.g. "db file sequential read", "log file sync"
  waitClass: OracleWaitClassName;
  totalWaits: number;
  timeWaitedSec: number;
  avgWaitMs: number;
  pctDbTime: number;
}

export interface OracleWaitClassSummary {
  waitClass: OracleWaitClassName;
  timeWaitedSec: number;
  pctTime: number;
  color: string;
}

export interface OracleDataGuardMetrics {
  enabled: boolean;
  configured: boolean;
  dbRole: "PRIMARY" | "PHYSICAL STANDBY" | "LOGICAL STANDBY" | "SNAPSHOT STANDBY";
  protectionMode: "MAXIMUM AVAILABILITY" | "MAXIMUM PERFORMANCE" | "MAXIMUM PROTECTION";
  status: "SYNCHRONIZED" | "APPLY_LAG" | "TRANSPORT_LAG" | "DISABLED" | "ERROR";
  transportLagSeconds: number;
  applyLagSeconds: number;
  redoTransportStatus: "VALID" | "CONNECTED" | "THROTTLED" | "ERROR";
  standbyApplyRateKbSec: number;
  gapStatus?: string;
  primaryInstanceName?: string;
  standbyInstanceName?: string;
}

export interface OracleBackgroundProcesses {
  pmon: ProcessStatus;
  smon: ProcessStatus;
  dbwr: ProcessStatus;
  lgwr: ProcessStatus;
  ckpt: ProcessStatus;
  mmon: ProcessStatus;
  arch: ProcessStatus;
}

export interface OracleTablespaceMetric {
  tablespaceName: string;
  conName?: string;
  conId?: number;
  totalMb: number;
  usedMb: number;
  freeMb: number;
  maxSizeMb: number;
  usedPct: number;
  freePct: number;
  autoextensible: boolean;
  status: "ONLINE" | "READ ONLY" | "OFFLINE";
  contents: "PERMANENT" | "TEMPORARY" | "UNDO";
}

export interface OracleInstanceInfo {
  dbName: string;
  dbUniqueName: string;
  instanceName: string;
  hostName: string;
  version: string;
  databaseRole: string;
  isCdb: boolean;
  openMode: OracleOpenMode;
  startupTime: string;
  uptimeSeconds: number;
  archivelogMode: "ARCHIVELOG" | "NOARCHIVELOG";
}

export interface OracleEngineMetrics {
  isCdb: boolean;
  cdbName?: string;
  instanceName: string;
  oracleHome?: string;
  archivelogMode: "ARCHIVELOG" | "NOARCHIVELOG";
  info?: OracleInstanceInfo;
  sga: OracleSGAMetrics;
  pga: OraclePGAMetrics;
  redoLogs: OracleRedoLogMetrics;
  asmEnabled?: boolean;
  asmDiskgroups: OracleASMDiskgroup[];
  topWaitEvents: OracleWaitEvent[];
  waitClasses: OracleWaitClassSummary[];
  dataGuard: OracleDataGuardMetrics;
  backgroundProcesses: OracleBackgroundProcesses;
  pdbs?: OraclePDBMetrics[];
  tablespaces: OracleTablespaceMetric[];
}

export interface OracleTelemetry extends OracleEngineMetrics {
  collectedAt: string;
  latencyMs: number;
  status: "ONLINE" | "DEGRADED" | "OFFLINE";
  error?: string;
}

export interface OracleConnectionConfig {
  host: string;
  port?: number;
  serviceName?: string;
  sid?: string;
  user?: string;
  password?: string;
  isSysDba?: boolean;
  poolMin?: number;
  poolMax?: number;
  poolIncrement?: number;
  poolTimeout?: number;
  connectTimeout?: number;
  queueTimeout?: number;
  isMock?: boolean;
  mockScenario?:
    | "HEALTHY_CDB"
    | "STANDALONE_NON_CDB"
    | "PDB_STARVATION"
    | "HIGH_LOG_SWITCH"
    | "TABLESPACE_FULL"
    | "DATA_GUARD_LAG"
    | "CHAOS_FAULT";
}

export interface IOracleDriver {
  connect(): Promise<void>;
  ping(): Promise<{ success: boolean; latencyMs: number }>;
  execute<T = any>(sql: string, binds?: Record<string, any> | any[]): Promise<T[]>;
  close(): Promise<void>;
  isHealthy(): boolean;
}
