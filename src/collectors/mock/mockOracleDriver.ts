/**
 * Deterministic Mock Oracle Driver
 * Path: src/collectors/mock/mockOracleDriver.ts
 */

import { IOracleDriver, OracleConnectionConfig } from "../../types/oracle";

export type MockScenario =
  | "HEALTHY_CDB"
  | "STANDALONE_NON_CDB"
  | "PDB_STARVATION"
  | "HIGH_LOG_SWITCH"
  | "TABLESPACE_FULL"
  | "DATA_GUARD_LAG"
  | "CHAOS_FAULT";

export class MockOracleDriver implements IOracleDriver {
  private connected: boolean = false;
  private scenario: MockScenario;
  private latencyMs: number = 2.5;
  private injectedError: Error | null = null;
  public queryExecutionCount: number = 0;
  public executedQueries: Array<{ sql: string; binds?: any }> = [];

  constructor(scenario: MockScenario = "HEALTHY_CDB") {
    this.scenario = scenario;
  }

  public setScenario(scenario: MockScenario): void {
    this.scenario = scenario;
  }

  public getScenario(): MockScenario {
    return this.scenario;
  }

  public injectError(error: Error | null): void {
    this.injectedError = error;
  }

  public setLatency(ms: number): void {
    this.latencyMs = ms;
  }

  public reset(): void {
    this.queryExecutionCount = 0;
    this.executedQueries = [];
    this.injectedError = null;
  }

  async connect(): Promise<void> {
    if (this.scenario === "CHAOS_FAULT" || this.injectedError) {
      throw this.injectedError || new Error("ORA-12541: TNS:no listener");
    }
    this.connected = true;
  }

  async ping(): Promise<{ success: boolean; latencyMs: number }> {
    if (!this.connected || this.scenario === "CHAOS_FAULT" || this.injectedError) {
      return { success: false, latencyMs: -1 };
    }
    return { success: true, latencyMs: this.latencyMs };
  }

  async close(): Promise<void> {
    this.connected = false;
  }

  isHealthy(): boolean {
    return this.connected && this.scenario !== "CHAOS_FAULT" && !this.injectedError;
  }

  async execute<T = any>(sql: string, binds: Record<string, any> | any[] = {}): Promise<T[]> {
    if (!this.connected) {
      throw new Error("ORA-03114: not connected to ORACLE");
    }
    if (this.scenario === "CHAOS_FAULT" || this.injectedError) {
      throw this.injectedError || new Error("ORA-03135: connection lost contact");
    }

    this.queryExecutionCount++;
    this.executedQueries.push({ sql, binds });

    const normalized = sql.replace(/\s+/g, " ").trim().toUpperCase();

    // 1. Topology & Instance Info
    if (normalized.includes("FROM V$DATABASE") && normalized.includes("V$INSTANCE")) {
      const isStandalone = this.scenario === "STANDALONE_NON_CDB";
      const isStandby = this.scenario === "DATA_GUARD_LAG";
      return [
        {
          DB_NAME: isStandalone ? "ORCLNONCDB" : "ORCLCDB",
          DB_UNIQUE_NAME: isStandalone ? "ORCLNONCDB_ST" : "ORCLCDB_PRX",
          DATABASE_ROLE: isStandby ? "PHYSICAL STANDBY" : "PRIMARY",
          CDB: isStandalone ? "NO" : "YES",
          OPEN_MODE: isStandby ? "READ ONLY WITH APPLY" : "READ WRITE",
          ARCHIVELOG_MODE: "ARCHIVELOG",
          INSTANCE_NAME: isStandalone ? "orclnoncdb1" : "orclcdb1",
          HOST_NAME: "ora-primary-01.corp.internal",
          VERSION: isStandalone ? "21.3.0.0.0" : "19.22.0.0.0",
          STARTUP_TIME: new Date(Date.now() - 14 * 86400 * 1000).toISOString(),
          UPTIME_SECONDS: 1209600,
          INSTANCE_STATUS: "OPEN",
        },
      ] as any;
    }

    // 2. SGA Info
    if (normalized.includes("FROM V$SGAINFO")) {
      return [
        { COMPONENT_NAME: "Maximum SGA Size", BYTES: 34359738368, RESIZEABLE: "No" }, // 32 GB
        { COMPONENT_NAME: "Buffer Cache Size", BYTES: 21474836480, RESIZEABLE: "Yes" }, // 20 GB
        { COMPONENT_NAME: "Shared Pool Size", BYTES: 8589934592, RESIZEABLE: "Yes" }, // 8 GB
        { COMPONENT_NAME: "Large Pool Size", BYTES: 1073741824, RESIZEABLE: "Yes" }, // 1 GB
        { COMPONENT_NAME: "Java Pool Size", BYTES: 536870912, RESIZEABLE: "Yes" }, // 512 MB
        { COMPONENT_NAME: "Free SGA Memory Available", BYTES: 2147483648, RESIZEABLE: "No" }, // 2 GB
        { COMPONENT_NAME: "Redo Buffers", BYTES: 67108864, RESIZEABLE: "No" }, // 64 MB
        { COMPONENT_NAME: "Streams Pool Size", BYTES: 268435456, RESIZEABLE: "Yes" }, // 256 MB
      ] as any;
    }

    // 3. PGA Stat
    if (normalized.includes("FROM V$PGASTAT")) {
      return [
        { NAME: "aggregate PGA target parameter", VALUE: 17179869184, UNIT: "bytes" }, // 16 GB
        { NAME: "total PGA allocated", VALUE: 12884901888, UNIT: "bytes" }, // 12 GB
        { NAME: "total PGA inuse", VALUE: 9663676416, UNIT: "bytes" }, // 9 GB
        { NAME: "total freeable PGA memory", VALUE: 2147483648, UNIT: "bytes" },
        { NAME: "maximum PGA allocated", VALUE: 15032385536, UNIT: "bytes" },
        { NAME: "PGA memory freed back to OS", VALUE: 42949672960, UNIT: "bytes" },
        { NAME: "cache hit percentage", VALUE: 98.4, UNIT: "percent" },
        { NAME: "over allocation count", VALUE: 0, UNIT: "count" },
      ] as any;
    }

    // 4. Buffer Cache Hit Ratio from V$SYSSTAT
    if (normalized.includes("FROM V$SYSSTAT") && (normalized.includes("BUFFER_CACHE_HIT_RATIO") || normalized.includes("PHYSICAL READS"))) {
      const hitRatio = this.scenario === "HIGH_LOG_SWITCH" ? 89.2 : 99.4;
      return [
        {
          BUFFER_CACHE_HIT_RATIO: hitRatio,
          PHYSICAL_READS_CACHE: this.scenario === "HIGH_LOG_SWITCH" ? 142000 : 14200,
          CONSISTENT_GETS_CACHE: 2150000,
          DB_BLOCK_GETS_CACHE: 380000,
        },
      ] as any;
    }

    // 5. Redo Log Switches & History
    if (normalized.includes("FROM V$LOG_HISTORY") && normalized.includes("TIME_BUCKET")) {
      const isHigh = this.scenario === "HIGH_LOG_SWITCH";
      const buckets: Array<{ TIME_BUCKET: string; SWITCH_COUNT: number }> = [];
      for (let i = 0; i < 24; i++) {
        const hourStr = `${i.toString().padStart(2, "0")}:00`;
        let count = 3 + (i % 3);
        if (isHigh && (i >= 13 && i <= 16)) {
          count = 24 + (i - 13) * 2; // Spikes up to 28
        }
        buckets.push({ TIME_BUCKET: hourStr, SWITCH_COUNT: count });
      }
      return buckets as any;
    }

    if (normalized.includes("FROM V$LOG_HISTORY")) {
      const isHigh = this.scenario === "HIGH_LOG_SWITCH";
      const switchHour = isHigh ? 28 : 4;
      return [
        {
          SWITCHES_LAST_HOUR: switchHour,
          SWITCHES_LAST_6H: isHigh ? 112 : 20,
          SWITCHES_LAST_24H: isHigh ? 240 : 80,
          AVG_SWITCHES_PER_HOUR: isHigh ? 10.0 : 3.33,
          LAST_SWITCH_TIME: new Date().toISOString(),
        },
      ] as any;
    }

    if (normalized.includes("FROM V$LOG") && !normalized.includes("V$LOG_HISTORY")) {
      return [
        { "GROUP#": 1, "THREAD#": 1, "SEQUENCE#": 48290, SIZE_MB: 1024, MEMBERS: 2, ARCHIVED: "YES", STATUS: "INACTIVE", FIRST_TIME: new Date(Date.now() - 3600000).toISOString() },
        { "GROUP#": 2, "THREAD#": 1, "SEQUENCE#": 48291, SIZE_MB: 1024, MEMBERS: 2, ARCHIVED: "YES", STATUS: "ACTIVE", FIRST_TIME: new Date(Date.now() - 1800000).toISOString() },
        { "GROUP#": 3, "THREAD#": 1, "SEQUENCE#": 48292, SIZE_MB: 1024, MEMBERS: 2, ARCHIVED: "NO", STATUS: "CURRENT", FIRST_TIME: new Date(Date.now() - 300000).toISOString() },
      ] as any;
    }

    if (normalized.includes("FROM V$INSTANCE_RECOVERY")) {
      return [
        {
          RECOVERY_ESTIMATED_IOS: 120,
          ACTUAL_REDO_BLKS: 450,
          TARGET_REDO_BLKS: 500,
          LOG_FILE_SIZE_BLKS: 2097152,
          ESTIMATED_MTTR: 15,
          TARGET_MTTR: 30,
          CKPT_BLOCK_WRITES: 840,
        },
      ] as any;
    }

    // 6. ASM Diskgroups
    if (normalized.includes("FROM V$ASM_DISKGROUP")) {
      const isAsmFull = this.scenario === "TABLESPACE_FULL";
      return [
        {
          GROUP_NUMBER: 1,
          DISKGROUP_NAME: "DATA",
          SECTOR_SIZE: 512,
          BLOCK_SIZE: 4096,
          ALLOCATION_UNIT_SIZE: 1048576,
          STATE: "MOUNTED",
          REDUNDANCY_TYPE: "NORMAL",
          TOTAL_MB: 2097152, // 2 TB
          FREE_MB: isAsmFull ? 88080 : 629145, // ~86 GB (4.2%) vs ~614 GB (30%)
          USABLE_FILE_MB: isAsmFull ? 0 : 314572,
          OFFLINE_DISKS: 0,
          USED_PCT: isAsmFull ? 95.8 : 70.0,
          FREE_PCT: isAsmFull ? 4.2 : 30.0,
        },
        {
          GROUP_NUMBER: 2,
          DISKGROUP_NAME: "RECO",
          SECTOR_SIZE: 512,
          BLOCK_SIZE: 4096,
          ALLOCATION_UNIT_SIZE: 1048576,
          STATE: "MOUNTED",
          REDUNDANCY_TYPE: "NORMAL",
          TOTAL_MB: 1048576, // 1 TB
          FREE_MB: 419430, // ~409 GB
          USABLE_FILE_MB: 209715,
          OFFLINE_DISKS: 0,
          USED_PCT: 60.0,
          FREE_PCT: 40.0,
        },
      ] as any;
    }

    // 7. Background Processes
    if (normalized.includes("FROM V$BGPROCESS")) {
      return [
        { PROCESS_NAME: "PMON", DESCRIPTION: "Process Monitor", OS_PID: "10412", STATUS: "RUNNING", PGA_USED_MB: 14.2, PGA_ALLOC_MB: 18.0, PGA_MAX_MB: 20.0, ERROR: 0 },
        { PROCESS_NAME: "SMON", DESCRIPTION: "System Monitor Process", OS_PID: "10414", STATUS: "RUNNING", PGA_USED_MB: 18.5, PGA_ALLOC_MB: 22.0, PGA_MAX_MB: 25.0, ERROR: 0 },
        { PROCESS_NAME: "DBW0", DESCRIPTION: "Database Writer Process 0", OS_PID: "10416", STATUS: "RUNNING", PGA_USED_MB: 48.0, PGA_ALLOC_MB: 54.0, PGA_MAX_MB: 60.0, ERROR: 0 },
        { PROCESS_NAME: "LGWR", DESCRIPTION: "Redo Log Writer Process", OS_PID: "10418", STATUS: "RUNNING", PGA_USED_MB: 32.1, PGA_ALLOC_MB: 38.0, PGA_MAX_MB: 42.0, ERROR: 0 },
        { PROCESS_NAME: "CKPT", DESCRIPTION: "Checkpoint Process", OS_PID: "10420", STATUS: "RUNNING", PGA_USED_MB: 12.0, PGA_ALLOC_MB: 16.0, PGA_MAX_MB: 18.0, ERROR: 0 },
        { PROCESS_NAME: "MMON", DESCRIPTION: "Manageability Monitor", OS_PID: "10422", STATUS: "RUNNING", PGA_USED_MB: 65.4, PGA_ALLOC_MB: 72.0, PGA_MAX_MB: 80.0, ERROR: 0 },
        { PROCESS_NAME: "ARC0", DESCRIPTION: "Archival Process 0", OS_PID: "10424", STATUS: "RUNNING", PGA_USED_MB: 24.0, PGA_ALLOC_MB: 30.0, PGA_MAX_MB: 35.0, ERROR: 0 },
      ] as any;
    }

    // 8. Pluggable Databases (V$PDBS)
    if (normalized.includes("FROM V$PDBS")) {
      if (this.scenario === "STANDALONE_NON_CDB") return [];
      return [
        { CON_ID: 2, DBID: 1002, PDB_NAME: "PDB$SEED", OPEN_MODE: "READ ONLY", RESTRICTED: "NO", OPEN_TIME: new Date(Date.now() - 14 * 86400 * 1000).toISOString(), TOTAL_SIZE_GB: 1.8, RECOVERY_STATUS: "ENABLED" },
        { CON_ID: 3, DBID: 2001, PDB_NAME: "PDB_FINANCE", OPEN_MODE: "READ WRITE", RESTRICTED: "NO", OPEN_TIME: new Date(Date.now() - 14 * 86400 * 1000).toISOString(), TOTAL_SIZE_GB: 450.5, RECOVERY_STATUS: "ENABLED" },
        { CON_ID: 4, DBID: 2002, PDB_NAME: "PDB_SALES_CRM", OPEN_MODE: "READ WRITE", RESTRICTED: "NO", OPEN_TIME: new Date(Date.now() - 14 * 86400 * 1000).toISOString(), TOTAL_SIZE_GB: 320.0, RECOVERY_STATUS: "ENABLED" },
        { CON_ID: 5, DBID: 2003, PDB_NAME: "PDB_AUDIT_LOGS", OPEN_MODE: "READ WRITE", RESTRICTED: "NO", OPEN_TIME: new Date(Date.now() - 14 * 86400 * 1000).toISOString(), TOTAL_SIZE_GB: 680.2, RECOVERY_STATUS: "ENABLED" },
      ] as any;
    }

    // 9. Per-PDB Resource Metric (V$RSRC_PDB_METRIC)
    if (normalized.includes("FROM V$RSRC_PDB_METRIC")) {
      if (this.scenario === "STANDALONE_NON_CDB") return [];
      const isStarved = this.scenario === "PDB_STARVATION";
      return [
        {
          CON_ID: 3,
          PDB_NAME: "PDB_FINANCE",
          CPU_UTILIZATION_LIMIT: 50,
          CPU_PCT_UTILIZED: isStarved ? 88.5 : 44.8,
          CPU_CONSUMED_SEC: 1420.5,
          CPU_WAITING_SEC: isStarved ? 28.5 : 12.4,
          RUNNING_SESSIONS_LIMIT: 50,
          AVG_RUNNING_SESSIONS: isStarved ? 24.5 : 18.2,
          AVG_WAITING_SESSIONS: isStarved ? 4.2 : 0.8,
          IOPS: 2400,
          IOMBPS: 84.5,
        },
        {
          CON_ID: 4,
          PDB_NAME: "PDB_SALES_CRM",
          CPU_UTILIZATION_LIMIT: 40,
          CPU_PCT_UTILIZED: 28.2,
          CPU_CONSUMED_SEC: 890.1,
          CPU_WAITING_SEC: 4.1,
          RUNNING_SESSIONS_LIMIT: 40,
          AVG_RUNNING_SESSIONS: 9.4,
          AVG_WAITING_SESSIONS: 0.1,
          IOPS: 1100,
          IOMBPS: 38.0,
        },
        {
          CON_ID: 5,
          PDB_NAME: "PDB_AUDIT_LOGS",
          CPU_UTILIZATION_LIMIT: 20,
          CPU_PCT_UTILIZED: 12.5,
          CPU_CONSUMED_SEC: 340.2,
          CPU_WAITING_SEC: 1.0,
          RUNNING_SESSIONS_LIMIT: 20,
          AVG_RUNNING_SESSIONS: 4.0,
          AVG_WAITING_SESSIONS: 0.0,
          IOPS: 520,
          IOMBPS: 18.2,
        },
      ] as any;
    }

    // 10. Sessions per PDB (V$SESSION)
    if (normalized.includes("FROM V$SESSION") && normalized.includes("GROUP BY S.CON_ID")) {
      if (this.scenario === "STANDALONE_NON_CDB") {
        return [
          { CON_ID: 0, PDB_NAME: "STANDALONE", TOTAL_SESSIONS: 35, ACTIVE_USER_SESSIONS: 12, INACTIVE_SESSIONS: 20, BLOCKED_SESSIONS: 0 },
        ] as any;
      }
      return [
        { CON_ID: 1, PDB_NAME: "CDB$ROOT", TOTAL_SESSIONS: 45, ACTIVE_USER_SESSIONS: 18, INACTIVE_SESSIONS: 25, BLOCKED_SESSIONS: 0 },
        { CON_ID: 3, PDB_NAME: "PDB_FINANCE", TOTAL_SESSIONS: 120, ACTIVE_USER_SESSIONS: 38, INACTIVE_SESSIONS: 80, BLOCKED_SESSIONS: 0 },
        { CON_ID: 4, PDB_NAME: "PDB_SALES_CRM", TOTAL_SESSIONS: 210, ACTIVE_USER_SESSIONS: 142, INACTIVE_SESSIONS: 65, BLOCKED_SESSIONS: 0 },
        { CON_ID: 5, PDB_NAME: "PDB_AUDIT_LOGS", TOTAL_SESSIONS: 30, ACTIVE_USER_SESSIONS: 12, INACTIVE_SESSIONS: 18, BLOCKED_SESSIONS: 0 },
      ] as any;
    }

    // 11. Tablespaces & Autoextend Headroom
    if (normalized.includes("CDB_DATA_FILES") || normalized.includes("DBA_DATA_FILES")) {
      const isTablespaceFull = this.scenario === "TABLESPACE_FULL";
      if (this.scenario === "STANDALONE_NON_CDB") {
        return [
          { CON_ID: 0, PDB_NAME: "STANDALONE", TABLESPACE_NAME: "SYSTEM", ALLOCATED_MB: 2048, USED_MB: 1820, FREE_MB: 228, MAX_SIZE_MB: 32768, TOTAL_HEADROOM_MB: 30948, USED_PCT_OF_MAX: 5.55, IS_AUTOEXTENSIBLE: "YES" },
          { CON_ID: 0, PDB_NAME: "STANDALONE", TABLESPACE_NAME: "SYSAUX", ALLOCATED_MB: 4096, USED_MB: 3450, FREE_MB: 646, MAX_SIZE_MB: 32768, TOTAL_HEADROOM_MB: 29318, USED_PCT_OF_MAX: 10.53, IS_AUTOEXTENSIBLE: "YES" },
          { CON_ID: 0, PDB_NAME: "STANDALONE", TABLESPACE_NAME: "USERS", ALLOCATED_MB: isTablespaceFull ? 32000 : 20480, USED_MB: isTablespaceFull ? 31400 : 12400, FREE_MB: isTablespaceFull ? 600 : 8080, MAX_SIZE_MB: 32768, TOTAL_HEADROOM_MB: isTablespaceFull ? 1368 : 20368, USED_PCT_OF_MAX: isTablespaceFull ? 95.82 : 37.84, IS_AUTOEXTENSIBLE: isTablespaceFull ? "NO" : "YES" },
          { CON_ID: 0, PDB_NAME: "STANDALONE", TABLESPACE_NAME: "UNDOTBS1", ALLOCATED_MB: 8192, USED_MB: 2100, FREE_MB: 6092, MAX_SIZE_MB: 32768, TOTAL_HEADROOM_MB: 30668, USED_PCT_OF_MAX: 6.41, IS_AUTOEXTENSIBLE: "YES" },
        ] as any;
      }
      return [
        { CON_ID: 1, PDB_NAME: "CDB$ROOT", TABLESPACE_NAME: "SYSTEM", ALLOCATED_MB: 2048, USED_MB: 1820, FREE_MB: 228, MAX_SIZE_MB: 32768, TOTAL_HEADROOM_MB: 30948, USED_PCT_OF_MAX: 5.55, IS_AUTOEXTENSIBLE: "YES" },
        { CON_ID: 1, PDB_NAME: "CDB$ROOT", TABLESPACE_NAME: "SYSAUX", ALLOCATED_MB: 4096, USED_MB: 3450, FREE_MB: 646, MAX_SIZE_MB: 32768, TOTAL_HEADROOM_MB: 29318, USED_PCT_OF_MAX: 10.53, IS_AUTOEXTENSIBLE: "YES" },
        { CON_ID: 3, PDB_NAME: "PDB_FINANCE", TABLESPACE_NAME: "FIN_DATA", ALLOCATED_MB: 256000, USED_MB: 198000, FREE_MB: 58000, MAX_SIZE_MB: 512000, TOTAL_HEADROOM_MB: 314000, USED_PCT_OF_MAX: 38.67, IS_AUTOEXTENSIBLE: "YES" },
        { CON_ID: 4, PDB_NAME: "PDB_SALES_CRM", TABLESPACE_NAME: "SALES_DATA", ALLOCATED_MB: isTablespaceFull ? 500000 : 380000, USED_MB: isTablespaceFull ? 490000 : 310000, FREE_MB: isTablespaceFull ? 10000 : 70000, MAX_SIZE_MB: 512000, TOTAL_HEADROOM_MB: isTablespaceFull ? 22000 : 202000, USED_PCT_OF_MAX: isTablespaceFull ? 95.70 : 60.55, IS_AUTOEXTENSIBLE: isTablespaceFull ? "NO" : "YES" },
      ] as any;
    }

    // 12. Top Wait Classes (V$SYSTEM_WAIT_CLASS)
    if (normalized.includes("FROM V$SYSTEM_WAIT_CLASS")) {
      return [
        { WAIT_CLASS: "System I/O", TOTAL_WAITS: 420190, TIME_WAITED_SEC: 820.5, AVG_WAIT_MS: 1.95 },
        { WAIT_CLASS: "Commit", TOTAL_WAITS: 184200, TIME_WAITED_SEC: 680.2, AVG_WAIT_MS: 3.69 },
        { WAIT_CLASS: "Concurrency", TOTAL_WAITS: 98400, TIME_WAITED_SEC: 420.0, AVG_WAIT_MS: 4.26 },
        { WAIT_CLASS: "Application", TOTAL_WAITS: 12400, TIME_WAITED_SEC: 250.0, AVG_WAIT_MS: 20.16 },
        { WAIT_CLASS: "Configuration", TOTAL_WAITS: 8500, TIME_WAITED_SEC: 95.0, AVG_WAIT_MS: 11.18 },
        { WAIT_CLASS: "Other", TOTAL_WAITS: 6200, TIME_WAITED_SEC: 45.0, AVG_WAIT_MS: 7.25 },
      ] as any;
    }

    // 13. Top Active Wait Events (V$SYSTEM_EVENT)
    if (normalized.includes("FROM V$SYSTEM_EVENT")) {
      const isHighLog = this.scenario === "HIGH_LOG_SWITCH";
      return [
        { EVENT: "db file sequential read", WAIT_CLASS: "System I/O", TOTAL_WAITS: 420190, TIME_WAITED_SEC: 820.5, AVG_WAIT_MS: 1.95 },
        { EVENT: "log file sync", WAIT_CLASS: "Commit", TOTAL_WAITS: isHighLog ? 580000 : 184200, TIME_WAITED_SEC: isHighLog ? 2450.0 : 680.2, AVG_WAIT_MS: isHighLog ? 22.5 : 3.69 },
        { EVENT: "db file scattered read", WAIT_CLASS: "System I/O", TOTAL_WAITS: 98400, TIME_WAITED_SEC: 420.0, AVG_WAIT_MS: 4.26 },
        { EVENT: "enq: TX - row lock contention", WAIT_CLASS: "Application", TOTAL_WAITS: 1240, TIME_WAITED_SEC: 250.0, AVG_WAIT_MS: 201.6 },
        { EVENT: "buffer busy waits", WAIT_CLASS: "Concurrency", TOTAL_WAITS: 12800, TIME_WAITED_SEC: 180.4, AVG_WAIT_MS: 14.06 },
      ] as any;
    }

    // 14. Blocking Sessions (V$SESSION)
    if (normalized.includes("FROM V$SESSION") && normalized.includes("BLOCKING_SESSION IS NOT NULL")) {
      return [] as any;
    }

    // 15. Data Guard Stats
    if (normalized.includes("FROM V$DATAGUARD_STATS")) {
      if (this.scenario === "STANDALONE_NON_CDB") return [];
      const isLag = this.scenario === "DATA_GUARD_LAG";
      return [
        { STAT_NAME: "transport lag", LAG_FORMATTED: isLag ? "+00 00:00:48" : "+00 00:00:00", UNIT: "second", TIME_COMPUTED: new Date().toISOString() },
        { STAT_NAME: "apply lag", LAG_FORMATTED: isLag ? "+00 00:05:45" : "+00 00:00:00", UNIT: "second", TIME_COMPUTED: new Date().toISOString() },
        { STAT_NAME: "apply finish time", LAG_FORMATTED: isLag ? "+00 00:05:45" : "+00 00:00:00", UNIT: "second", TIME_COMPUTED: new Date().toISOString() },
      ] as any;
    }

    if (normalized.includes("FROM V$ARCHIVE_DEST_STATUS")) {
      if (this.scenario === "STANDALONE_NON_CDB") return [];
      const isLag = this.scenario === "DATA_GUARD_LAG";
      return [
        {
          DEST_ID: 2,
          DEST_NAME: "LOG_ARCHIVE_DEST_2",
          STATUS: "VALID",
          TARGET: "STANDBY",
          DATABASE_MODE: "MOUNTED",
          RECOVERY_MODE: "MANAGED REAL TIME APPLY",
          PROTECTION_MODE: "MAXIMUM AVAILABILITY",
          "APPLIED_SEQ#": 48291,
          GAP_STATUS: isLag ? "UNRESOLVED" : "NONE",
          ERROR: null,
        },
      ] as any;
    }

    // Default fallback
    return [] as any;
  }
}
