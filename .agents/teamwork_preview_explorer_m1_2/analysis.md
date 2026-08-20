# Technical Analysis & Design Specification
## Oracle Diagnostic Rule Engine & Gemini AI Integration (Milestone 1)

**Agent**: `teamwork_preview_explorer_m1_2` (Explorer 2)  
**Date**: 2026-08-19  
**Target Milestone**: Milestone 1 — Oracle Database Monitoring  
**Target Module**: `src/diagnostics/rules/oracleRules.ts`, `server.ts`, `tests/oracleRules.test.ts`  

---

## 1. Executive Summary

This specification defines the **Oracle Diagnostic Rule Engine** and **Gemini AI Root Cause Analysis (RCA) Integration** for DataPulse DBA Sentinel. The system provides:

1. **Deterministic Rule Heuristics (`ORCL-01` to `ORCL-05`)**: Fast, memory-efficient, mathematically rigorous heuristic evaluation over Oracle engine telemetry (SGA buffer cache, redo log switch frequencies, multitenant PDB CPU skew, ASM diskgroup capacity, and Data Guard replication lag).
2. **Gemini AI DBA Prompt Builder**: Enriched multi-modal context construction for Google Gemini (`gemini-3.6-flash`), transforming raw Oracle metrics, active wait classes, and container topology into structured DBA incident action plans with exact remediation SQL.
3. **Deterministic Fallback Engine**: Zero-dependency fallback mechanism that synthesizes actionable diagnostic reports, remediation scripts, and threshold advice when `GEMINI_API_KEY` is not present or when offline.
4. **Complete Unit Test Architecture**: Comprehensive test suite (`tests/oracleRules.test.ts`) executing via Node.js test runner (`node:test` + `node:assert`) covering normal, boundary, warning, critical, and malformed telemetry scenarios.

---

## 2. Rule Heuristics Specification (ORCL-01 to ORCL-05)

```
                                  +---------------------------------------+
                                  |   Oracle Telemetry Snapshot Input     |
                                  +---------------------------------------+
                                                      |
                         +----------------------------+----------------------------+
                         |                            |                            |
                         v                            v                            v
              [Memory & Throughput]          [Multitenant & Storage]          [High Availability]
                         |                            |                            |
             +-----------+-----------+        +-------+-------+                    v
             |                       |        |               |             [Data Guard Lag]
             v                       v        v               v                    |
         [ORCL-01]               [ORCL-02] [ORCL-03]       [ORCL-04]            [ORCL-05]
    Buffer Cache < 90%     Redo Switch > 6/h PDB CPU > 70%  ASM Free < 15%      Lag > 60s
             |                       |        |               |                    |
             v                       v        v               v                    v
      SGA DB_CACHE_SIZE       Resize Redo Logs  CDB Resource   ASM Rebalance /   MRP Recovery /
        Resize SQL             to 4GB / 8GB     Plan Limits       Add Disks      Network Tuning
```

---

### 2.1 ORCL-01: Low Buffer Cache Hit Ratio

- **Rule ID**: `ORCL-01`
- **Rule Name**: `Low Oracle Buffer Cache Hit Ratio`
- **Category**: `Memory & Performance`
- **Target Metric**: Buffer Cache Hit Ratio (%)
  $$\text{Hit Ratio} = \left(1 - \frac{\text{Physical Reads Cache}}{\text{Consistent Gets Cache} + \text{DB Block Gets Cache}}\right) \times 100$$
- **Thresholds**:
  - `CRITICAL`: $\text{Hit Ratio} < 80.0\%$
  - `WARNING`: $80.0\% \le \text{Hit Ratio} < 90.0\%$
  - `OK`: $\text{Hit Ratio} \ge 90.0\%$
- **Root Cause Analysis**:
  - Undersized SGA Buffer Cache (`DB_CACHE_SIZE`) relative to working dataset.
  - Queries performing unindexed Full Table Scans (FTS) or fast full index scans, evicting warm data blocks from the LRU cache.
  - Inadequate Automatic Shared Memory Management (ASMM) / Automatic Memory Management (AMM) configuration causing memory starvation.
- **Impact**:
  - Disk I/O latency amplification (`db file sequential read`, `db file scattered read` wait events).
  - High query latency spikes, increased host storage IOPS, and CPU consumption in I/O wait.
- **Remediation Actions & SQL**:
  1. Inspect `V$DB_CACHE_ADVICE` for estimated physical read reduction at higher cache sizes.
  2. Dynamically increase `DB_CACHE_SIZE` or `SGA_TARGET`.
  3. Identify queries with high `DISK_READS` in `V$SQL` for indexing.
  ```sql
  -- 1. Check Buffer Cache Sizing Advice
  SELECT size_for_estimate, size_factor, estd_physical_reads, estd_physical_read_factor 
  FROM v$db_cache_advice WHERE name = 'DEFAULT';

  -- 2. Dynamically Increase Buffer Cache Size (Example: Resize to 32GB)
  ALTER SYSTEM SET db_cache_size = 32G SCOPE=BOTH;

  -- 3. If ASMM is enabled, increase global SGA target
  ALTER SYSTEM SET sga_target = 64G SCOPE=BOTH;
  ```

---

### 2.2 ORCL-02: Excessive Redo Log Switching

- **Rule ID**: `ORCL-02`
- **Rule Name**: `Excessive Redo Log Switch Frequency`
- **Category**: `Storage & Checkpoint Throughput`
- **Target Metric**: Redo Log Switches per Hour (from `V$LOG_HISTORY`)
- **Thresholds**:
  - `CRITICAL`: $\text{Switches} > 12 \text{ per hour}$ (Switch frequency $< 5 \text{ minutes}$)
  - `WARNING`: $6 < \text{Switches} \le 12 \text{ per hour}$ (Switch frequency between $5 \text{ and } 10 \text{ minutes}$)
  - `OK`: $\text{Switches} \le 6 \text{ per hour}$ (Optimal baseline is 2–4 switches/hour)
- **Root Cause Analysis**:
  - Undersized online redo log groups (e.g. default 50MB–500MB) under heavy DML write operations.
  - Frequent log switches triggering aggressive DBWR incremental checkpoints, saturating storage I/O and checkpoint queues.
- **Impact**:
  - Checkpoint storms, transaction commit stalls, elevated `log file sync` and `log file switch (checkpoint incomplete)` wait events.
  - Archiver (`ARCn`) process contention copying undersized redo logs to the Fast Recovery Area (FRA).
- **Remediation Actions & SQL**:
  1. Add new, larger online redo log groups (recommended 4GB to 8GB each).
  2. Switch logfiles until all old groups transition to `INACTIVE`.
  3. Drop undersized legacy redo log groups.
  ```sql
  -- 1. Inspect current redo log configuration
  SELECT group#, bytes/(1024*1024) AS size_mb, status, archived FROM v$log;

  -- 2. Add larger (4GB) redo log groups
  ALTER DATABASE ADD LOGFILE GROUP 4 ('+DATA/ORCLCDB/ONLINELOG/redo04.log') SIZE 4G;
  ALTER DATABASE ADD LOGFILE GROUP 5 ('+DATA/ORCLCDB/ONLINELOG/redo05.log') SIZE 4G;
  ALTER DATABASE ADD LOGFILE GROUP 6 ('+DATA/ORCLCDB/ONLINELOG/redo06.log') SIZE 4G;

  -- 3. Force log switch and checkpoint
  ALTER SYSTEM SWITCH LOGFILE;
  ALTER SYSTEM CHECKPOINT;

  -- 4. Drop legacy undersized redo log group once status becomes INACTIVE
  ALTER DATABASE DROP LOGFILE GROUP 1;
  ```

---

### 2.3 ORCL-03: PDB CPU Hogging / Resource Skew

- **Rule ID**: `ORCL-03`
- **Rule Name**: `Pluggable Database (PDB) CPU Skew & Starvation`
- **Category**: `Multitenant Governance & CPU Allocation`
- **Target Metric**: Single PDB CPU Utilization % relative to CDB total (`cpuUtilizationPct` from `V$RSRC_PDB_METRIC`)
- **Thresholds**:
  - `CRITICAL`: Single PDB CPU $> 85.0\%$ OR ($> 70.0\%$ with `avgWaitingSessions > 0`)
  - `WARNING`: Single PDB CPU $> 70.0\%$ (and $\le 85.0\%$ with no waiting sessions)
  - `OK`: All PDBs $\le 70.0\%$
- **Root Cause Analysis**:
  - Runaway batch ETL, unconstrained parallel query execution (`PARALLEL_MAX_SERVERS`), or missing Resource Manager CDB plan directives.
  - Tenant workload monopolizing host CPU cores, starving critical peer PDBs.
- **Impact**:
  - Multitenant noisy neighbor effect: critical business PDBs experience latency degradation and CPU scheduling delays (`resmgr: cpu quantum` waits).
- **Remediation Actions & SQL**:
  1. Create or update the active CDB Resource Manager plan directive to enforce CPU shares (`shares`) and hard/soft utilization caps (`utilization_limit`).
  2. Identify top CPU-consuming sessions within the offending PDB.
  ```sql
  -- 1. Configure CDB Resource Plan Directives with CPU capping
  BEGIN
    DBMS_RESOURCE_MANAGER.CREATE_PENDING_AREA();
    DBMS_RESOURCE_MANAGER.UPDATE_PLAN_DIRECTIVE(
      plan => 'DEFAULT_CDB_PLAN',
      pluggable_database => 'PDB_SALES',
      shares => 100,
      utilization_limit => 50, -- Cap offending tenant at 50% CDB CPU
      parallel_server_limit => 40
    );
    DBMS_RESOURCE_MANAGER.SUBMIT_PENDING_AREA();
  END;
  /

  -- 2. Activate CDB Resource Plan
  ALTER SYSTEM SET resource_manager_plan = 'DEFAULT_CDB_PLAN' SCOPE=BOTH;

  -- 3. Identify offending sessions inside PDB
  SELECT s.sid, s.serial#, s.username, s.sql_id, s.status, s.last_call_et
  FROM v$session s
  JOIN v$pdbs p ON s.con_id = p.con_id
  WHERE p.name = 'PDB_SALES' AND s.status = 'ACTIVE'
  ORDER BY s.last_call_et DESC;
  ```

---

### 2.4 ORCL-04: ASM Diskgroup Space Exhaustion

- **Rule ID**: `ORCL-04`
- **Rule Name**: `ASM Diskgroup Space Exhaustion Risk`
- **Category**: `Storage Capacity & ASM Infrastructure`
- **Target Metric**: Free Space % factoring ASM Redundancy (`freePct` or $\frac{\text{usable\_file\_mb}}{\text{total\_mb}} \times 100$ from `V$ASM_DISKGROUP`)
- **Thresholds**:
  - `CRITICAL`: $\text{Free Space} < 5.0\%$ (or $\text{Usable File MB} \le 0$)
  - `WARNING`: $5.0\% \le \text{Free Space} < 15.0\%$
  - `OK`: $\text{Free Space} \ge 15.0\%$
- **Root Cause Analysis**:
  - Rapid table/index growth approaching diskgroup capacity limits.
  - Archive logs or RMAN backup dumps filling the Fast Recovery Area (`+RECO` or `+FRA`).
  - Autoextensible datafiles without maximum limits consuming available allocation units.
- **Impact**:
  - Database freeze or shutdown if redo/archive log diskgroup fills (`ORA-00257: archiver error`).
  - Transaction failure with `ORA-01653: unable to extend table` or `ORA-15041: diskgroup space exhausted`.
- **Remediation Actions & SQL**:
  1. Add physical disks / LUNs to the ASM diskgroup with rebalance power.
  2. Purge expired archive logs and obsolete RMAN backups.
  3. Rebalance ASM diskgroup to distribute allocation units.
  ```sql
  -- 1. Check ASM Diskgroup Status and Disks
  SELECT group_number, name, state, type, total_mb, free_mb, usable_file_mb, offline_disks
  FROM v$asm_diskgroup;

  -- 2. Add New Disks to Diskgroup with Rebalance
  ALTER DISKGROUP DATA ADD DISK '/dev/oracleasm/disks/DISK06' REBALANCE POWER 8;

  -- 3. If FRA / RECO diskgroup is full, purge obsolete archive logs via RMAN
  -- RMAN> BACKUP ARCHIVELOG ALL DELETE INPUT;
  -- RMAN> DELETE OBSOLETE;
  ```

---

### 2.5 ORCL-05: Data Guard Replication Lag

- **Rule ID**: `ORCL-05`
- **Rule Name**: `Data Guard Replication & Transport Lag Breach`
- **Category**: `Disaster Recovery & High Availability`
- **Target Metric**: Replication Apply Lag / Transport Lag in Seconds (`applyLagSeconds` from `V$DATAGUARD_STATS`)
- **Thresholds**:
  - `CRITICAL`: $\text{Apply Lag} > 300 \text{ seconds}$ (5 minutes) OR `gapStatus != 'NONE'`
  - `WARNING`: $60 \text{ seconds} < \text{Apply Lag} \le 300 \text{ seconds}$
  - `OK`: $\text{Apply Lag} \le 60 \text{ seconds}$
- **Root Cause Analysis**:
  - Network bandwidth saturation or packet drops on the redo transport link (`LNS` / `ASYNC` / `SYNC`).
  - Managed Recovery Process (MRP0) on the Standby node is single-threaded or blocked by slow disk write speeds on standby redo logs.
  - Redo sequence gap requiring archived redo log fetching from primary.
- **Impact**:
  - Increased Recovery Point Objective (RPO) and Recovery Time Objective (RTO) exposure.
  - Stale read data on Active Data Guard standby instances.
- **Remediation Actions & SQL**:
  1. Check MRP status and Standby Redo Log (SRL) configuration.
  2. Increase parallel redo apply worker count.
  3. Validate Oracle Net Session Data Unit (SDU) sizing for high-throughput transport.
  ```sql
  -- 1. Query Data Guard Lag Statistics
  SELECT name, value, unit FROM v$dataguard_stats;

  -- 2. Query Archive Destination Status on Primary
  SELECT dest_id, status, error, gap_status, applied_seq# FROM v$archive_dest_status WHERE status != 'INACTIVE';

  -- 3. Cancel and Restart Managed Recovery with Real-Time Parallel Apply
  ALTER DATABASE RECOVER MANAGED STANDBY DATABASE CANCEL;
  ALTER DATABASE RECOVER MANAGED STANDBY DATABASE DISCONNECT FROM SESSION PARALLEL 8 USING CURRENT LOGFILE;

  -- 4. Tune TNS transport SDU in sqlnet.ora & tnsnames.ora:
  -- DEFAULT_SDU_SIZE = 65535
  ```

---

## 3. TypeScript Code Implementation Blueprint (`src/diagnostics/rules/oracleRules.ts`)

Below is the complete, self-contained architecture for `src/diagnostics/rules/oracleRules.ts`:

```typescript
/**
 * Oracle DBA Diagnostic Rule Engine & Heuristics
 * Path: src/diagnostics/rules/oracleRules.ts
 */

export type DiagnosticSeverity = 'CRITICAL' | 'WARNING' | 'INFO' | 'OK';

export interface OracleRuleResult {
  ruleId: 'ORCL-01' | 'ORCL-02' | 'ORCL-03' | 'ORCL-04' | 'ORCL-05';
  name: string;
  category: string;
  severity: DiagnosticSeverity;
  triggered: boolean;
  metricValue: number;
  threshold: number;
  unit: string;
  targetResource: string;
  summary: string;
  rootCause: string;
  impact: string;
  remediationSql: string[];
  remediationActions: string[];
  documentationRef: string;
}

export interface OracleDiagnosticReport {
  instanceName: string;
  databaseRole: string;
  isCdb: boolean;
  overallHealth: 'HEALTHY' | 'WARNING' | 'CRITICAL';
  evaluatedAt: string;
  findings: OracleRuleResult[];
  criticalCount: number;
  warningCount: number;
  remediationSummary: string[];
}

/**
 * Minimal Telemetry Contract required by Rule Evaluator
 */
export interface OracleTelemetryInput {
  instanceName?: string;
  isCdb?: boolean;
  databaseRole?: string;
  bufferHitRatio?: number;
  sga?: {
    totalMb?: number;
    bufferCacheMb?: number;
    sharedPoolMb?: number;
    bufferCacheHitRatio?: number;
  };
  redo?: {
    switchesLastHour?: number;
    switchesLast24h?: number;
    avgSwitchesPerHour?: number;
  };
  pdbs?: Array<{
    conId: number;
    name: string;
    cpuUtilizationPct?: number;
    avgWaitingSessions?: number;
    cpuWaitingSec?: number;
  }>;
  asmEnabled?: boolean;
  asmDiskgroups?: Array<{
    name: string;
    totalMb: number;
    freeMb: number;
    usableFileMb?: number;
    usedPct: number;
    freePct: number;
    offlineDisks?: number;
  }>;
  dataGuard?: {
    configured?: boolean;
    role?: string;
    applyLagSeconds?: number;
    transportLagSeconds?: number;
    gapStatus?: string;
  };
  topWaitEvents?: Array<{
    event: string;
    waitClass: string;
    avgWaitMs: number;
  }>;
}

/**
 * Evaluates ORCL-01: Buffer Cache Hit Ratio
 */
export function evaluateBufferCache(telemetry: OracleTelemetryInput): OracleRuleResult {
  const hitRatio = telemetry.sga?.bufferCacheHitRatio ?? telemetry.bufferHitRatio ?? 100;
  let severity: DiagnosticSeverity = 'OK';
  let triggered = false;
  let summary = `Buffer cache hit ratio is healthy at ${hitRatio.toFixed(1)}%.`;

  if (hitRatio < 80.0) {
    severity = 'CRITICAL';
    triggered = true;
    summary = `Critical buffer cache hit ratio deficit (${hitRatio.toFixed(1)}% < 80.0%). Excessive disk I/O and block eviction.`;
  } else if (hitRatio < 90.0) {
    severity = 'WARNING';
    triggered = true;
    summary = `Sub-optimal buffer cache hit ratio (${hitRatio.toFixed(1)}% < 90.0%). Increased physical read waits detected.`;
  }

  return {
    ruleId: 'ORCL-01',
    name: 'Low Oracle Buffer Cache Hit Ratio',
    category: 'Memory & Performance',
    severity,
    triggered,
    metricValue: Number(hitRatio.toFixed(1)),
    threshold: severity === 'CRITICAL' ? 80.0 : 90.0,
    unit: '%',
    targetResource: 'SGA Buffer Cache (DB_CACHE_SIZE)',
    summary,
    rootCause: 'SGA Buffer Cache is undersized for the current active working set, or queries with missing indexes are performing full table scans.',
    impact: 'Increased disk I/O latency (db file sequential/scattered read), CPU contention in I/O wait, and elevated transaction response times.',
    remediationSql: [
      "SELECT size_for_estimate, size_factor, estd_physical_reads FROM v$db_cache_advice WHERE name = 'DEFAULT';",
      'ALTER SYSTEM SET db_cache_size = 32G SCOPE=BOTH;',
      'ALTER SYSTEM SET sga_target = 64G SCOPE=BOTH;',
    ],
    remediationActions: [
      'Inspect V$DB_CACHE_ADVICE to determine optimal buffer cache memory allocation.',
      'Increase DB_CACHE_SIZE dynamically or raise SGA_TARGET if ASMM is active.',
      'Identify top SQL queries with high DISK_READS in V$SQL and generate covering B-Tree indexes.',
    ],
    documentationRef: 'Oracle Database Performance Tuning Guide - Sizing the Buffer Cache',
  };
}

/**
 * Evaluates ORCL-02: Excessive Redo Log Switching
 */
export function evaluateRedoLogSwitching(telemetry: OracleTelemetryInput): OracleRuleResult {
  const switches = telemetry.redo?.switchesLastHour ?? 0;
  let severity: DiagnosticSeverity = 'OK';
  let triggered = false;
  let summary = `Redo log switch rate is optimal (${switches} switches/hour).`;

  if (switches > 12) {
    severity = 'CRITICAL';
    triggered = true;
    summary = `Critical redo log switch rate (${switches}/hour > 12/hour). Frequent DBWR checkpoints and commit stalls.`;
  } else if (switches > 6) {
    severity = 'WARNING';
    triggered = true;
    summary = `Elevated redo log switch rate (${switches}/hour > 6/hour). Checkpoint latency may impact write throughput.`;
  }

  return {
    ruleId: 'ORCL-02',
    name: 'Excessive Redo Log Switch Frequency',
    category: 'Storage & Checkpoint Throughput',
    severity,
    triggered,
    metricValue: switches,
    threshold: severity === 'CRITICAL' ? 12 : 6,
    unit: 'switches/hr',
    targetResource: 'Online Redo Log Groups',
    summary,
    rootCause: 'Online Redo Log files are undersized for the current DML write volume, forcing frequent LGWR switches and continuous DBWR checkpoints.',
    impact: 'Elevated log file sync and log file switch wait events, checkpoint storms, and increased I/O load on storage subsystem.',
    remediationSql: [
      'SELECT group#, bytes/(1024*1024) AS size_mb, status FROM v$log;',
      "ALTER DATABASE ADD LOGFILE GROUP 4 ('+DATA/ORCLCDB/ONLINELOG/redo04.log') SIZE 4G;",
      "ALTER DATABASE ADD LOGFILE GROUP 5 ('+DATA/ORCLCDB/ONLINELOG/redo05.log') SIZE 4G;",
      'ALTER SYSTEM SWITCH LOGFILE;',
      'ALTER SYSTEM CHECKPOINT;',
      'ALTER DATABASE DROP LOGFILE GROUP 1;',
    ],
    remediationActions: [
      'Add new 4GB or 8GB online redo log groups to achieve the optimal target of 2-4 switches per hour.',
      'Force log switches and checkpoints until old undersized groups become INACTIVE.',
      'Drop obsolete undersized redo log groups.',
    ],
    documentationRef: 'Oracle Database Administrator Guide - Managing the Redo Log',
  };
}

/**
 * Evaluates ORCL-03: PDB CPU Hogging / Resource Skew
 */
export function evaluatePdbCpuSkew(telemetry: OracleTelemetryInput): OracleRuleResult {
  const pdbs = telemetry.pdbs || [];
  if (!telemetry.isCdb || pdbs.length === 0) {
    return {
      ruleId: 'ORCL-03',
      name: 'Pluggable Database (PDB) CPU Skew & Starvation',
      category: 'Multitenant Governance & CPU Allocation',
      severity: 'OK',
      triggered: false,
      metricValue: 0,
      threshold: 70.0,
      unit: '%',
      targetResource: 'CDB Resource Manager',
      summary: 'Non-CDB standalone instance or no PDBs registered. Rule evaluated as OK.',
      rootCause: 'N/A',
      impact: 'N/A',
      remediationSql: [],
      remediationActions: [],
      documentationRef: 'Oracle Database Administrator Guide - Managing Resource Allocation in CDB',
    };
  }

  // Find max CPU consuming PDB
  let maxPdb = pdbs[0];
  for (const pdb of pdbs) {
    if ((pdb.cpuUtilizationPct ?? 0) > (maxPdb.cpuUtilizationPct ?? 0)) {
      maxPdb = pdb;
    }
  }

  const maxCpu = maxPdb.cpuUtilizationPct ?? 0;
  const waitingSessions = maxPdb.avgWaitingSessions ?? 0;

  let severity: DiagnosticSeverity = 'OK';
  let triggered = false;
  let summary = `PDB CPU distribution is balanced (highest: ${maxPdb.name} at ${maxCpu.toFixed(1)}%).`;

  if (maxCpu > 85.0 || (maxCpu > 70.0 && waitingSessions > 0)) {
    severity = 'CRITICAL';
    triggered = true;
    summary = `Critical PDB CPU hogging: ${maxPdb.name} is consuming ${maxCpu.toFixed(1)}% CDB CPU with ${waitingSessions} waiting sessions, starving peer tenants.`;
  } else if (maxCpu > 70.0) {
    severity = 'WARNING';
    triggered = true;
    summary = `Elevated PDB CPU skew: ${maxPdb.name} is consuming ${maxCpu.toFixed(1)}% CDB CPU. Monitor for potential tenant starvation.`;
  }

  return {
    ruleId: 'ORCL-03',
    name: 'Pluggable Database (PDB) CPU Skew & Starvation',
    category: 'Multitenant Governance & CPU Allocation',
    severity,
    triggered,
    metricValue: Number(maxCpu.toFixed(1)),
    threshold: severity === 'CRITICAL' ? 85.0 : 70.0,
    unit: '%',
    targetResource: `PDB: ${maxPdb.name}`,
    summary,
    rootCause: `Pluggable database ${maxPdb.name} is executing unconstrained batch or CPU-intensive queries without active Resource Manager plan directives.`,
    impact: 'Noisy neighbor effect starving co-hosted PDBs of CPU cycles, resulting in latency spikes across the CDB.',
    remediationSql: [
      'BEGIN\n' +
        '  DBMS_RESOURCE_MANAGER.CREATE_PENDING_AREA();\n' +
        `  DBMS_RESOURCE_MANAGER.UPDATE_PLAN_DIRECTIVE(\n` +
        `    plan => 'DEFAULT_CDB_PLAN',\n` +
        `    pluggable_database => '${maxPdb.name}',\n` +
        '    shares => 100,\n' +
        '    utilization_limit => 50\n' +
        '  );\n' +
        '  DBMS_RESOURCE_MANAGER.SUBMIT_PENDING_AREA();\n' +
        'END;\n' +
        '/',
      "ALTER SYSTEM SET resource_manager_plan = 'DEFAULT_CDB_PLAN' SCOPE=BOTH;",
      `SELECT sid, serial#, username, sql_id, cpu_time FROM v$session WHERE con_id = ${maxPdb.conId} AND status = 'ACTIVE' ORDER BY cpu_time DESC;`,
    ],
    remediationActions: [
      `Enforce a CDB Resource Manager Plan directive to cap ${maxPdb.name} CPU utilization at 50%.`,
      'Activate CDB Resource Plan across the cluster.',
      `Investigate long-running queries inside ${maxPdb.name} and terminate runaway sessions if necessary.`,
    ],
    documentationRef: 'Oracle Multitenant Administrator Guide - Using Oracle Resource Manager with CDBs and PDBs',
  };
}

/**
 * Evaluates ORCL-04: ASM Diskgroup Space Exhaustion
 */
export function evaluateAsmDiskgroupSpace(telemetry: OracleTelemetryInput): OracleRuleResult {
  const diskgroups = telemetry.asmDiskgroups || [];
  if (telemetry.asmEnabled === false || diskgroups.length === 0) {
    return {
      ruleId: 'ORCL-04',
      name: 'ASM Diskgroup Space Exhaustion Risk',
      category: 'Storage Capacity & ASM Infrastructure',
      severity: 'OK',
      triggered: false,
      metricValue: 100,
      threshold: 15.0,
      unit: '%',
      targetResource: 'ASM Diskgroups',
      summary: 'ASM is not enabled or no diskgroups configured. Rule evaluated as OK.',
      rootCause: 'N/A',
      impact: 'N/A',
      remediationSql: [],
      remediationActions: [],
      documentationRef: 'Automatic Storage Management Administrator Guide - Managing ASM Diskgroups',
    };
  }

  // Find most constrained diskgroup
  let minDg = diskgroups[0];
  for (const dg of diskgroups) {
    if (dg.freePct < minDg.freePct) {
      minDg = dg;
    }
  }

  const freePct = minDg.freePct;
  let severity: DiagnosticSeverity = 'OK';
  let triggered = false;
  let summary = `ASM Diskgroup space is healthy (lowest free: ${minDg.name} at ${freePct.toFixed(1)}% free).`;

  if (freePct < 5.0 || (minDg.usableFileMb !== undefined && minDg.usableFileMb <= 0)) {
    severity = 'CRITICAL';
    triggered = true;
    summary = `Critical ASM space exhaustion on diskgroup ${minDg.name} (${freePct.toFixed(1)}% free < 5.0%). Imminent datafile extend failure.`;
  } else if (freePct < 15.0) {
    severity = 'WARNING';
    triggered = true;
    summary = `Warning: Low free space on ASM diskgroup ${minDg.name} (${freePct.toFixed(1)}% free < 15.0%). Capacity expansion required.`;
  }

  return {
    ruleId: 'ORCL-04',
    name: 'ASM Diskgroup Space Exhaustion Risk',
    category: 'Storage Capacity & ASM Infrastructure',
    severity,
    triggered,
    metricValue: Number(freePct.toFixed(1)),
    threshold: severity === 'CRITICAL' ? 5.0 : 15.0,
    unit: '%',
    targetResource: `ASM Diskgroup: +${minDg.name}`,
    summary,
    rootCause: `Diskgroup +${minDg.name} has consumed over ${(100 - freePct).toFixed(1)}% of raw capacity due to rapid datafile growth or unpurged archive logs.`,
    impact: 'Inability to extend datafiles (ORA-01653), transaction rollbacks, or instance stall if archive destination is full (ORA-00257).',
    remediationSql: [
      `SELECT name, total_mb, free_mb, usable_file_mb FROM v$asm_diskgroup WHERE name = '${minDg.name}';`,
      `ALTER DISKGROUP ${minDg.name} ADD DISK '/dev/oracleasm/disks/DISK_NEW' REBALANCE POWER 8;`,
      '-- If FRA diskgroup, clean up archive logs via RMAN:\n-- RMAN> BACKUP ARCHIVELOG ALL DELETE INPUT;',
    ],
    remediationActions: [
      `Provision and add new LUNs to diskgroup +${minDg.name} with rebalance power 8.`,
      'Purge obsolete RMAN backups and expired archivelogs if Fast Recovery Area (FRA) is impacted.',
      'Audit tablespace autoextend settings on datafiles located in this diskgroup.',
    ],
    documentationRef: 'Automatic Storage Management Administrator Guide - Adding and Dropping Disks',
  };
}

/**
 * Evaluates ORCL-05: Data Guard Replication Lag
 */
export function evaluateDataGuardLag(telemetry: OracleTelemetryInput): OracleRuleResult {
  const dg = telemetry.dataGuard;
  if (!dg || dg.configured === false) {
    return {
      ruleId: 'ORCL-05',
      name: 'Data Guard Replication & Transport Lag Breach',
      category: 'Disaster Recovery & High Availability',
      severity: 'OK',
      triggered: false,
      metricValue: 0,
      threshold: 60,
      unit: 'sec',
      targetResource: 'Data Guard Standby',
      summary: 'Data Guard is not configured on this instance. Rule evaluated as OK.',
      rootCause: 'N/A',
      impact: 'N/A',
      remediationSql: [],
      remediationActions: [],
      documentationRef: 'Oracle Data Guard Concepts and Administration - Monitoring Data Guard',
    };
  }

  const applyLag = dg.applyLagSeconds ?? 0;
  const transportLag = dg.transportLagSeconds ?? 0;
  const hasGap = dg.gapStatus && dg.gapStatus !== 'NONE';

  let severity: DiagnosticSeverity = 'OK';
  let triggered = false;
  let summary = `Data Guard replication is synchronized (Apply lag: ${applyLag}s, Transport lag: ${transportLag}s).`;

  if (applyLag > 300 || hasGap) {
    severity = 'CRITICAL';
    triggered = true;
    summary = `Critical Data Guard replication lag (${applyLag}s > 300s)${hasGap ? ' with active redo sequence gap' : ''}. RPO SLA breach.`;
  } else if (applyLag > 60 || transportLag > 30) {
    severity = 'WARNING';
    triggered = true;
    summary = `Data Guard replication lag warning (Apply lag: ${applyLag}s > 60s, Transport lag: ${transportLag}s).`;
  }

  return {
    ruleId: 'ORCL-05',
    name: 'Data Guard Replication & Transport Lag Breach',
    category: 'Disaster Recovery & High Availability',
    severity,
    triggered,
    metricValue: applyLag,
    threshold: severity === 'CRITICAL' ? 300 : 60,
    unit: 'sec',
    targetResource: 'Data Guard Standby Apply Process (MRP0)',
    summary,
    rootCause: hasGap
      ? 'Redo sequence gap detected between Primary and Standby destination.'
      : 'Managed Recovery Process (MRP0) on Standby is lagging behind primary redo generation due to transport bandwidth or I/O bottleneck.',
    impact: 'Increased Recovery Point Objective (RPO) and Recovery Time Objective (RTO) exposure in failover scenarios.',
    remediationSql: [
      'SELECT name, value, unit FROM v$dataguard_stats;',
      'SELECT dest_id, status, error, gap_status FROM v$archive_dest_status WHERE status != \'INACTIVE\';',
      'ALTER DATABASE RECOVER MANAGED STANDBY DATABASE CANCEL;',
      'ALTER DATABASE RECOVER MANAGED STANDBY DATABASE DISCONNECT FROM SESSION PARALLEL 8 USING CURRENT LOGFILE;',
    ],
    remediationActions: [
      'Inspect standby alert log for ORA-00312, ORA-16014, or network timeout messages.',
      'Restart Managed Recovery Process (MRP0) with parallel apply workers.',
      'Tune Net8 Session Data Unit (SDU) sizing in sqlnet.ora (SDU=65535) for high-bandwidth redo transport.',
    ],
    documentationRef: 'Oracle Data Guard Concepts and Administration - Tuning Redo Apply',
  };
}

/**
 * Main Rule Engine Evaluator: Evaluates all 5 rules against telemetry snapshot
 */
export function evaluateOracleRules(telemetry: OracleTelemetryInput): OracleDiagnosticReport {
  const r1 = evaluateBufferCache(telemetry);
  const r2 = evaluateRedoLogSwitching(telemetry);
  const r3 = evaluatePdbCpuSkew(telemetry);
  const r4 = evaluateAsmDiskgroupSpace(telemetry);
  const r5 = evaluateDataGuardLag(telemetry);

  const findings = [r1, r2, r3, r4, r5];
  const criticalCount = findings.filter((f) => f.severity === 'CRITICAL').length;
  const warningCount = findings.filter((f) => f.severity === 'WARNING').length;

  let overallHealth: 'HEALTHY' | 'WARNING' | 'CRITICAL' = 'HEALTHY';
  if (criticalCount > 0) overallHealth = 'CRITICAL';
  else if (warningCount > 0) overallHealth = 'WARNING';

  const remediationSummary = findings
    .filter((f) => f.triggered)
    .map((f) => `[${f.ruleId} ${f.severity}] ${f.targetResource}: ${f.remediationActions[0]}`);

  return {
    instanceName: telemetry.instanceName || 'ORACLE_INSTANCE',
    databaseRole: telemetry.databaseRole || 'PRIMARY',
    isCdb: telemetry.isCdb ?? false,
    overallHealth,
    evaluatedAt: new Date().toISOString(),
    findings,
    criticalCount,
    warningCount,
    remediationSummary,
  };
}
```

---

## 4. Gemini AI DBA Prompt Builder & Fallback Architecture

### 4.1 Prompt Builder Design (`buildOracleGeminiPrompt`)

When a DBA triggers an AI diagnosis for an Oracle incident or slow query, the backend synthesizes the telemetry snapshot and deterministic rule evaluations into a prompt for Gemini:

```typescript
export function buildOracleGeminiPrompt(
  telemetry: OracleTelemetryInput,
  report: OracleDiagnosticReport,
  context?: { incidentContext?: string; query?: string; type?: string }
): string {
  const isSlowQuery = context?.type === 'slow_query';

  return `You are a Senior Principal Oracle Certified Master DBA (19c/21c/23ai) specializing in high-availability enterprise architectures, Multitenant (CDB/PDB), and Exadata performance optimization.

### TARGET ENVIRONMENT CONTEXT:
- Instance Name: ${report.instanceName}
- Architecture: ${report.isCdb ? 'Multitenant Container Database (CDB/PDB)' : 'Standalone (Non-CDB)'}
- Database Role: ${report.databaseRole}
- Overall Sentinel Health Status: ${report.overallHealth}
- Evaluation Timestamp: ${report.evaluatedAt}

### TELEMETRY SNAPSHOT:
1. SGA & Memory:
   - Buffer Cache Hit Ratio: ${telemetry.sga?.bufferCacheHitRatio ?? telemetry.bufferHitRatio ?? 'N/A'}%
   - Buffer Cache Size: ${telemetry.sga?.bufferCacheMb ?? 'N/A'} MB
   - Shared Pool Size: ${telemetry.sga?.sharedPoolMb ?? 'N/A'} MB
2. Redo Log Switch Rate: ${telemetry.redo?.switchesLastHour ?? 0} switches in the last hour (24h avg: ${telemetry.redo?.avgSwitchesPerHour ?? 0}/hr)
3. Multitenant PDBs:
${(telemetry.pdbs || []).map((p) => `   - PDB: ${p.name} (ConID: ${p.conId}) | CPU Util: ${p.cpuUtilizationPct ?? 0}% | Waiting Sessions: ${p.avgWaitingSessions ?? 0}`).join('\n') || '   - None (Non-CDB)'}
4. ASM Diskgroups:
${(telemetry.asmDiskgroups || []).map((dg) => `   - +${dg.name}: Total ${dg.totalMb} MB, Free ${dg.freeMb} MB (${dg.freePct}% free)`).join('\n') || '   - ASM Not Configured'}
5. Data Guard Replication:
   - Configured: ${telemetry.dataGuard?.configured ? 'YES' : 'NO'}
   - Apply Lag: ${telemetry.dataGuard?.applyLagSeconds ?? 0}s | Transport Lag: ${telemetry.dataGuard?.transportLagSeconds ?? 0}s | Gap Status: ${telemetry.dataGuard?.gapStatus ?? 'NONE'}
6. Active Wait Events:
${(telemetry.topWaitEvents || []).map((w) => `   - ${w.event} (${w.waitClass}): avg wait ${w.avgWaitMs}ms`).join('\n') || '   - No severe wait events active'}

### DETERMINISTIC HEURISTIC FINDINGS:
${report.findings.filter((f) => f.triggered).map((f) => `- [${f.ruleId} - ${f.severity}] ${f.name} on ${f.targetResource}: ${f.summary}`).join('\n') || '- All deterministic rule heuristics passed with zero threshold breaches.'}

${
  isSlowQuery
    ? `### TARGET SLOW QUERY TO ANALYZE:
\`\`\`sql
${context?.query || "SELECT /*+ MONITOR */ * FROM v$session WHERE status = 'ACTIVE';"}
\`\`\`
`
    : `### INCIDENT CONTEXT:
${context?.incidentContext || 'Proactive health inspection and anomaly diagnostic scan.'}
`
}

### INSTRUCTIONS:
Provide an expert, structured DBA incident response plan formatted in Markdown:
1. **Executive Summary & Severity Assessment**: Clear 2-sentence impact synopsis.
2. **Root Cause Analysis (RCA)**: Deep-dive correlation between active wait events, memory/PDB CPU skew, and storage metrics.
3. **Immediate Remediation Plan**: Step-by-step DBA actions with executable Oracle SQL / PL*SQL / RMAN commands.
4. **Engine Parameter Tuning**: Specific \`ALTER SYSTEM\` parameters (e.g. \`db_cache_size\`, \`resource_manager_plan\`, \`sdu\`).
5. **Preventative Monitoring Configuration**: Recommended Sentinel threshold rules to prevent recurrence.`;
}
```

---

### 4.2 Deterministic Fallback Engine (`buildDeterministicOracleFallback`)

When `GEMINI_API_KEY` is not present, the system returns a deterministic fallback response synthesized directly from the rule engine output:

```typescript
export interface FallbackDiagnosticResponse {
  analysis: string;
  recommendations: string[];
  suggestedSql: string;
  overallHealth: string;
  ruleResults: OracleRuleResult[];
  timestamp: string;
}

export function buildDeterministicOracleFallback(
  telemetry: OracleTelemetryInput,
  report: OracleDiagnosticReport
): FallbackDiagnosticResponse {
  const triggered = report.findings.filter((f) => f.triggered);
  const recommendations: string[] = [];
  const sqlStatements: string[] = [];

  let analysisBody = `[DataPulse Sentinel Deterministic Oracle Diagnostics - Offline Rule Engine Engine]
Target Instance: ${report.instanceName} (${report.isCdb ? 'Multitenant CDB' : 'Standalone'})
Database Role: ${report.databaseRole}
Health Status: ${report.overallHealth} (Critical: ${report.criticalCount}, Warnings: ${report.warningCount})
Evaluated At: ${report.evaluatedAt}\n\n`;

  if (triggered.length === 0) {
    analysisBody += `Key Findings:
1. All core Oracle subsystems (SGA buffer cache, redo log generation, PDB CPU balance, ASM storage, and Data Guard replication) are operating within healthy operating thresholds.
2. Zero active heuristic rule violations detected.

Recommended Action:
- Continue standard polling cadence.
- Ensure automated RMAN backup schedules remain healthy.`;
    recommendations.push('Maintain existing operational thresholds', 'Verify regular RMAN backup completion');
    sqlStatements.push('-- System Operating Normally\nSELECT instance_name, status, database_status FROM v$instance;');
  } else {
    analysisBody += 'Key Findings:\n';
    triggered.forEach((f, idx) => {
      analysisBody += `${idx + 1}. [${f.ruleId} - ${f.severity}] ${f.name} on ${f.targetResource}:\n   ${f.summary}\n   Root Cause: ${f.rootCause}\n   Impact: ${f.impact}\n\n`;
      f.remediationActions.forEach((a) => recommendations.push(a));
      f.remediationSql.forEach((s) => sqlStatements.push(s));
    });

    analysisBody += 'Recommended Remediation Actions:\n';
    recommendations.slice(0, 5).forEach((rec, i) => {
      analysisBody += `${i + 1}. ${rec}\n`;
    });
  }

  const suggestedSql = sqlStatements.length > 0 ? sqlStatements.join('\n\n') : '-- No remediation SQL required';

  return {
    analysis: analysisBody,
    recommendations,
    suggestedSql,
    overallHealth: report.overallHealth,
    ruleResults: report.findings,
    timestamp: new Date().toISOString(),
  };
}
```

---

## 5. Server Integration Architecture (`server.ts`)

In `server.ts`, the `/api/ai/diagnose` route seamlessly branches for `databaseType === "Oracle"`:

```typescript
// Inside server.ts POST /api/ai/diagnose handler:

const { type, query, metrics, databaseType, incidentContext, telemetry } = req.body;

if (databaseType === 'Oracle' || metrics?.engine === 'Oracle') {
  // Extract or synthesize Oracle telemetry
  const oracleTelemetry: OracleTelemetryInput = telemetry || {
    instanceName: metrics?.name || 'ORCLCDB',
    isCdb: metrics?.engineSpecific?.isCdb ?? true,
    databaseRole: metrics?.engineSpecific?.databaseRole ?? 'PRIMARY',
    bufferHitRatio: metrics?.bufferHitRatio ?? 98.5,
    sga: metrics?.engineSpecific?.sga,
    redo: metrics?.engineSpecific?.redo,
    pdbs: metrics?.engineSpecific?.pdbs,
    asmEnabled: metrics?.engineSpecific?.asmEnabled ?? true,
    asmDiskgroups: metrics?.engineSpecific?.asmDiskgroups,
    dataGuard: metrics?.engineSpecific?.dataGuard,
    topWaitEvents: metrics?.engineSpecific?.topWaitEvents,
  };

  // 1. Run deterministic rule evaluation
  const report = evaluateOracleRules(oracleTelemetry);

  // 2. If Gemini API key is missing, return deterministic fallback
  if (!ai) {
    const fallback = buildDeterministicOracleFallback(oracleTelemetry, report);
    return res.json(fallback);
  }

  // 3. If Gemini is available, build rich DBA prompt
  const prompt = buildOracleGeminiPrompt(oracleTelemetry, report, {
    type,
    query,
    incidentContext,
  });

  const response = await ai.models.generateContent({
    model: 'gemini-3.6-flash',
    contents: prompt,
    config: {
      temperature: 0.2,
    },
  });

  return res.json({
    analysis: response.text || 'No diagnosis output generated.',
    report,
    timestamp: new Date().toISOString(),
  });
}
```

---

## 6. Unit Test Design Specification (`tests/oracleRules.test.ts`)

The test suite is designed for zero external dependencies using Node.js built-in `node:test` and `node:assert`:

```typescript
/**
 * Oracle Diagnostic Rules & AI Prompt Unit Tests
 * File: tests/oracleRules.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateBufferCache,
  evaluateRedoLogSwitching,
  evaluatePdbCpuSkew,
  evaluateAsmDiskgroupSpace,
  evaluateDataGuardLag,
  evaluateOracleRules,
  buildDeterministicOracleFallback,
  buildOracleGeminiPrompt,
  OracleTelemetryInput,
} from '../src/diagnostics/rules/oracleRules';

describe('Oracle Diagnostic Rules Engine (ORCL-01 to ORCL-05)', () => {
  // 1. ORCL-01: Buffer Cache Hit Ratio
  describe('ORCL-01: Buffer Cache Hit Ratio', () => {
    it('should pass with OK status when hit ratio is >= 90%', () => {
      const telemetry: OracleTelemetryInput = {
        sga: { bufferCacheHitRatio: 99.4 },
      };
      const result = evaluateBufferCache(telemetry);
      assert.equal(result.ruleId, 'ORCL-01');
      assert.equal(result.severity, 'OK');
      assert.equal(result.triggered, false);
      assert.equal(result.metricValue, 99.4);
    });

    it('should trigger WARNING when hit ratio is between 80% and 89.9%', () => {
      const telemetry: OracleTelemetryInput = {
        sga: { bufferCacheHitRatio: 88.5 },
      };
      const result = evaluateBufferCache(telemetry);
      assert.equal(result.severity, 'WARNING');
      assert.equal(result.triggered, true);
      assert.equal(result.metricValue, 88.5);
      assert.ok(result.remediationSql.some((s) => s.includes('db_cache_size')));
    });

    it('should trigger CRITICAL when hit ratio drops below 80%', () => {
      const telemetry: OracleTelemetryInput = {
        sga: { bufferCacheHitRatio: 74.2 },
      };
      const result = evaluateBufferCache(telemetry);
      assert.equal(result.severity, 'CRITICAL');
      assert.equal(result.triggered, true);
      assert.equal(result.metricValue, 74.2);
    });

    it('should fallback to root bufferHitRatio if sga object is absent', () => {
      const telemetry: OracleTelemetryInput = {
        bufferHitRatio: 85.0,
      };
      const result = evaluateBufferCache(telemetry);
      assert.equal(result.severity, 'WARNING');
      assert.equal(result.metricValue, 85.0);
    });
  });

  // 2. ORCL-02: Excessive Redo Log Switching
  describe('ORCL-02: Redo Log Switch Frequency', () => {
    it('should pass with OK when switch rate is <= 6 switches/hour', () => {
      const telemetry: OracleTelemetryInput = {
        redo: { switchesLastHour: 4 },
      };
      const result = evaluateRedoLogSwitching(telemetry);
      assert.equal(result.ruleId, 'ORCL-02');
      assert.equal(result.severity, 'OK');
      assert.equal(result.triggered, false);
    });

    it('should trigger WARNING when switch rate is between 7 and 12 switches/hour', () => {
      const telemetry: OracleTelemetryInput = {
        redo: { switchesLastHour: 9 },
      };
      const result = evaluateRedoLogSwitching(telemetry);
      assert.equal(result.severity, 'WARNING');
      assert.equal(result.triggered, true);
      assert.equal(result.metricValue, 9);
      assert.ok(result.remediationSql.some((s) => s.includes('SIZE 4G')));
    });

    it('should trigger CRITICAL when switch rate exceeds 12 switches/hour', () => {
      const telemetry: OracleTelemetryInput = {
        redo: { switchesLastHour: 28 },
      };
      const result = evaluateRedoLogSwitching(telemetry);
      assert.equal(result.severity, 'CRITICAL');
      assert.equal(result.triggered, true);
      assert.equal(result.metricValue, 28);
    });
  });

  // 3. ORCL-03: PDB CPU Hogging / Resource Skew
  describe('ORCL-03: PDB CPU Skew & Multitenant Starvation', () => {
    it('should evaluate as OK for non-CDB instances', () => {
      const telemetry: OracleTelemetryInput = {
        isCdb: false,
        pdbs: [],
      };
      const result = evaluatePdbCpuSkew(telemetry);
      assert.equal(result.severity, 'OK');
      assert.equal(result.triggered, false);
    });

    it('should pass as OK when all PDBs consume <= 70% CPU', () => {
      const telemetry: OracleTelemetryInput = {
        isCdb: true,
        pdbs: [
          { conId: 3, name: 'PDB_FINANCE', cpuUtilizationPct: 45.0, avgWaitingSessions: 0 },
          { conId: 4, name: 'PDB_SALES', cpuUtilizationPct: 30.0, avgWaitingSessions: 0 },
        ],
      };
      const result = evaluatePdbCpuSkew(telemetry);
      assert.equal(result.severity, 'OK');
      assert.equal(result.triggered, false);
    });

    it('should trigger WARNING when a PDB consumes > 70% CPU without waiting sessions', () => {
      const telemetry: OracleTelemetryInput = {
        isCdb: true,
        pdbs: [
          { conId: 3, name: 'PDB_FINANCE', cpuUtilizationPct: 76.5, avgWaitingSessions: 0 },
          { conId: 4, name: 'PDB_SALES', cpuUtilizationPct: 15.0, avgWaitingSessions: 0 },
        ],
      };
      const result = evaluatePdbCpuSkew(telemetry);
      assert.equal(result.severity, 'WARNING');
      assert.equal(result.triggered, true);
      assert.equal(result.targetResource, 'PDB: PDB_FINANCE');
    });

    it('should trigger CRITICAL when a PDB consumes > 85% CPU or causes session starvation', () => {
      const telemetry: OracleTelemetryInput = {
        isCdb: true,
        pdbs: [
          { conId: 3, name: 'PDB_FINANCE', cpuUtilizationPct: 92.0, avgWaitingSessions: 4 },
          { conId: 4, name: 'PDB_SALES', cpuUtilizationPct: 4.0, avgWaitingSessions: 2 },
        ],
      };
      const result = evaluatePdbCpuSkew(telemetry);
      assert.equal(result.severity, 'CRITICAL');
      assert.equal(result.triggered, true);
      assert.ok(result.remediationSql.some((s) => s.includes('DBMS_RESOURCE_MANAGER')));
    });
  });

  // 4. ORCL-04: ASM Diskgroup Space Exhaustion
  describe('ORCL-04: ASM Diskgroup Space Exhaustion', () => {
    it('should evaluate as OK when ASM is disabled', () => {
      const telemetry: OracleTelemetryInput = {
        asmEnabled: false,
        asmDiskgroups: [],
      };
      const result = evaluateAsmDiskgroupSpace(telemetry);
      assert.equal(result.severity, 'OK');
      assert.equal(result.triggered, false);
    });

    it('should pass as OK when free space is >= 15%', () => {
      const telemetry: OracleTelemetryInput = {
        asmEnabled: true,
        asmDiskgroups: [
          { name: 'DATA', totalMb: 2097152, freeMb: 629145, freePct: 30.0, usedPct: 70.0 },
          { name: 'RECO', totalMb: 1048576, freeMb: 419430, freePct: 40.0, usedPct: 60.0 },
        ],
      };
      const result = evaluateAsmDiskgroupSpace(telemetry);
      assert.equal(result.severity, 'OK');
      assert.equal(result.triggered, false);
    });

    it('should trigger WARNING when free space is between 5% and 14.9%', () => {
      const telemetry: OracleTelemetryInput = {
        asmEnabled: true,
        asmDiskgroups: [
          { name: 'DATA', totalMb: 2097152, freeMb: 209715, freePct: 10.0, usedPct: 90.0 },
        ],
      };
      const result = evaluateAsmDiskgroupSpace(telemetry);
      assert.equal(result.severity, 'WARNING');
      assert.equal(result.triggered, true);
      assert.equal(result.targetResource, 'ASM Diskgroup: +DATA');
    });

    it('should trigger CRITICAL when free space drops below 5%', () => {
      const telemetry: OracleTelemetryInput = {
        asmEnabled: true,
        asmDiskgroups: [
          { name: 'DATA', totalMb: 2097152, freeMb: 62914, freePct: 3.0, usedPct: 97.0, usableFileMb: 0 },
        ],
      };
      const result = evaluateAsmDiskgroupSpace(telemetry);
      assert.equal(result.severity, 'CRITICAL');
      assert.equal(result.triggered, true);
      assert.ok(result.remediationSql.some((s) => s.includes('ADD DISK')));
    });
  });

  // 5. ORCL-05: Data Guard Replication Lag
  describe('ORCL-05: Data Guard Replication Lag', () => {
    it('should evaluate as OK when Data Guard is not configured', () => {
      const telemetry: OracleTelemetryInput = {
        dataGuard: { configured: false },
      };
      const result = evaluateDataGuardLag(telemetry);
      assert.equal(result.severity, 'OK');
      assert.equal(result.triggered, false);
    });

    it('should pass as OK when lag is <= 60 seconds', () => {
      const telemetry: OracleTelemetryInput = {
        dataGuard: {
          configured: true,
          role: 'PHYSICAL STANDBY',
          applyLagSeconds: 12,
          transportLagSeconds: 2,
          gapStatus: 'NONE',
        },
      };
      const result = evaluateDataGuardLag(telemetry);
      assert.equal(result.severity, 'OK');
      assert.equal(result.triggered, false);
    });

    it('should trigger WARNING when apply lag is between 61s and 300s', () => {
      const telemetry: OracleTelemetryInput = {
        dataGuard: {
          configured: true,
          role: 'PHYSICAL STANDBY',
          applyLagSeconds: 140,
          transportLagSeconds: 10,
          gapStatus: 'NONE',
        },
      };
      const result = evaluateDataGuardLag(telemetry);
      assert.equal(result.severity, 'WARNING');
      assert.equal(result.triggered, true);
      assert.equal(result.metricValue, 140);
    });

    it('should trigger CRITICAL when apply lag exceeds 300s or has archive gap', () => {
      const telemetry: OracleTelemetryInput = {
        dataGuard: {
          configured: true,
          role: 'PHYSICAL STANDBY',
          applyLagSeconds: 840,
          transportLagSeconds: 120,
          gapStatus: 'LOCATED',
        },
      };
      const result = evaluateDataGuardLag(telemetry);
      assert.equal(result.severity, 'CRITICAL');
      assert.equal(result.triggered, true);
      assert.ok(result.remediationSql.some((s) => s.includes('PARALLEL 8')));
    });
  });

  // 6. Full Engine Evaluation & Fallback / Prompt Builders
  describe('Engine Aggregator & Fallback Synthesis', () => {
    it('should aggregate healthy telemetry into HEALTHY overall status', () => {
      const telemetry: OracleTelemetryInput = {
        instanceName: 'ORCL_PROD',
        isCdb: true,
        sga: { bufferCacheHitRatio: 99.1 },
        redo: { switchesLastHour: 3 },
        pdbs: [{ conId: 3, name: 'SALES', cpuUtilizationPct: 25.0 }],
        asmEnabled: true,
        asmDiskgroups: [{ name: 'DATA', totalMb: 1000, freeMb: 400, freePct: 40.0, usedPct: 60.0 }],
        dataGuard: { configured: true, applyLagSeconds: 5 },
      };
      const report = evaluateOracleRules(telemetry);
      assert.equal(report.overallHealth, 'HEALTHY');
      assert.equal(report.criticalCount, 0);
      assert.equal(report.warningCount, 0);

      const fallback = buildDeterministicOracleFallback(telemetry, report);
      assert.equal(fallback.overallHealth, 'HEALTHY');
      assert.ok(fallback.analysis.includes('Operating Normally') || fallback.analysis.includes('healthy operating thresholds'));
    });

    it('should synthesize critical findings into deterministic fallback report', () => {
      const telemetry: OracleTelemetryInput = {
        instanceName: 'ORCL_CRIT',
        isCdb: true,
        sga: { bufferCacheHitRatio: 72.0 }, // CRITICAL ORCL-01
        redo: { switchesLastHour: 24 },     // CRITICAL ORCL-02
        pdbs: [{ conId: 3, name: 'SALES', cpuUtilizationPct: 91.0, avgWaitingSessions: 3 }], // CRITICAL ORCL-03
        asmEnabled: true,
        asmDiskgroups: [{ name: 'DATA', totalMb: 1000, freeMb: 30, freePct: 3.0, usedPct: 97.0 }], // CRITICAL ORCL-04
        dataGuard: { configured: true, applyLagSeconds: 600 }, // CRITICAL ORCL-05
      };
      const report = evaluateOracleRules(telemetry);
      assert.equal(report.overallHealth, 'CRITICAL');
      assert.equal(report.criticalCount, 5);

      const fallback = buildDeterministicOracleFallback(telemetry, report);
      assert.equal(fallback.overallHealth, 'CRITICAL');
      assert.ok(fallback.suggestedSql.includes('db_cache_size'));
      assert.ok(fallback.suggestedSql.includes('SIZE 4G'));
      assert.ok(fallback.suggestedSql.includes('DBMS_RESOURCE_MANAGER'));
      assert.ok(fallback.suggestedSql.includes('ADD DISK'));
      assert.ok(fallback.suggestedSql.includes('PARALLEL 8'));
    });

    it('should build valid Gemini AI prompt containing all context sections', () => {
      const telemetry: OracleTelemetryInput = {
        instanceName: 'ORCL_AI_TEST',
        isCdb: true,
        sga: { bufferCacheHitRatio: 86.0 },
        redo: { switchesLastHour: 8 },
      };
      const report = evaluateOracleRules(telemetry);
      const prompt = buildOracleGeminiPrompt(telemetry, report, {
        incidentContext: 'High CPU and slow order processing observed during peak hours.',
      });

      assert.ok(prompt.includes('ORCL_AI_TEST'));
      assert.ok(prompt.includes('Buffer Cache Hit Ratio: 86%'));
      assert.ok(prompt.includes('ORCL-01'));
      assert.ok(prompt.includes('ORCL-02'));
      assert.ok(prompt.includes('High CPU and slow order processing'));
    });
  });
});
```

---

## 7. Downstream Implementation Plan & Builder Handoff

| Task | Target Path | Dependencies | Verification Command |
|---|---|---|---|
| **1. Create Rules Module** | `src/diagnostics/rules/oracleRules.ts` | None | `npx tsc --noEmit` |
| **2. Integrate Express Route** | `server.ts` | `src/diagnostics/rules/oracleRules.ts` | `npx tsx server.ts` |
| **3. Create Unit Tests** | `tests/oracleRules.test.ts` | `src/diagnostics/rules/oracleRules.ts` | `npx tsx --test tests/oracleRules.test.ts` |
| **4. Update Dashboard Modal Integration** | `src/components/ai/AIDiagnosticModal.tsx` | `server.ts` | Browser verification / Type check |
