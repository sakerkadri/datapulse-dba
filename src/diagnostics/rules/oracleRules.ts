/**
 * Oracle DBA Diagnostic Rule Engine & AI Context Synthesizer
 * Path: src/diagnostics/rules/oracleRules.ts
 */

import {
  OracleTelemetry,
  OracleEngineMetrics,
  OracleInstanceInfo,
  OracleSGAMetrics,
  OraclePGAMetrics,
  OracleRedoLogMetrics,
  OracleASMDiskgroup,
  OracleDataGuardMetrics,
  OracleBackgroundProcesses,
  OraclePDBMetrics,
  OracleTablespaceMetric,
  OracleWaitEvent,
  OracleWaitClassSummary,
} from "../../types/oracle";

export type DiagnosticSeverity = "CRITICAL" | "WARNING" | "INFO" | "OK";

export interface OracleRuleResult {
  ruleId: "ORCL-01" | "ORCL-02" | "ORCL-03" | "ORCL-04" | "ORCL-05";
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
  overallHealth: "HEALTHY" | "WARNING" | "CRITICAL";
  evaluatedAt: string;
  findings: OracleRuleResult[];
  criticalCount: number;
  warningCount: number;
  remediationSummary: string[];
}

export interface FallbackDiagnosticResponse {
  analysis: string;
  recommendations: string[];
  suggestedSql: string;
  overallHealth: string;
  ruleResults: OracleRuleResult[];
  timestamp: string;
}

export interface OracleTelemetryInput {
  instanceName?: string;
  isCdb?: boolean;
  databaseRole?: string;
  archivelogMode?: "ARCHIVELOG" | "NOARCHIVELOG";
  bufferHitRatio?: number;
  info?: Partial<OracleInstanceInfo>;
  sga?: Partial<OracleSGAMetrics>;
  pga?: Partial<OraclePGAMetrics>;
  redoLogs?: Partial<OracleRedoLogMetrics>;
  asmEnabled?: boolean;
  asmDiskgroups?: Array<Partial<OracleASMDiskgroup>>;
  dataGuard?: Partial<OracleDataGuardMetrics>;
  backgroundProcesses?: Partial<OracleBackgroundProcesses>;
  pdbs?: Array<Partial<OraclePDBMetrics>>;
  tablespaces?: Array<Partial<OracleTablespaceMetric>>;
  topWaitEvents?: Array<Partial<OracleWaitEvent>>;
  waitClasses?: Array<Partial<OracleWaitClassSummary>>;
}

/**
 * ORCL-01: Low Buffer Cache Hit Ratio
 */
export function evaluateBufferCache(telemetry: OracleTelemetryInput): OracleRuleResult {
  const hitRatio = telemetry.sga?.bufferCacheHitRatio ?? telemetry.bufferHitRatio ?? 100;
  let severity: DiagnosticSeverity = "OK";
  let triggered = false;
  let summary = `Buffer cache hit ratio is healthy at ${hitRatio.toFixed(1)}%.`;

  if (hitRatio < 80.0) {
    severity = "CRITICAL";
    triggered = true;
    summary = `Critical buffer cache hit ratio deficit (${hitRatio.toFixed(1)}% < 80.0%). Excessive disk I/O and block eviction.`;
  } else if (hitRatio < 90.0) {
    severity = "WARNING";
    triggered = true;
    summary = `Sub-optimal buffer cache hit ratio (${hitRatio.toFixed(1)}% < 90.0%). Increased physical read waits detected.`;
  }

  return {
    ruleId: "ORCL-01",
    name: "Low Oracle Buffer Cache Hit Ratio",
    category: "Memory & Performance",
    severity,
    triggered,
    metricValue: Number(hitRatio.toFixed(1)),
    threshold: severity === "CRITICAL" ? 80.0 : 90.0,
    unit: "%",
    targetResource: "SGA Buffer Cache (DB_CACHE_SIZE)",
    summary,
    rootCause: "SGA Buffer Cache is undersized for the current active working set, or queries with missing indexes are performing full table scans.",
    impact: "Increased disk I/O latency (db file sequential/scattered read), CPU contention in I/O wait, and elevated transaction response times.",
    remediationSql: [
      "SELECT size_for_estimate, size_factor, estd_physical_reads FROM v$db_cache_advice WHERE name = 'DEFAULT';",
      "ALTER SYSTEM SET db_cache_size = 32G SCOPE=BOTH;",
      "ALTER SYSTEM SET sga_target = 64G SCOPE=BOTH;",
    ],
    remediationActions: [
      "Inspect V$DB_CACHE_ADVICE to determine optimal buffer cache memory allocation.",
      "Increase DB_CACHE_SIZE dynamically or raise SGA_TARGET if ASMM is active.",
      "Identify top SQL queries with high DISK_READS in V$SQL and generate covering B-Tree indexes.",
    ],
    documentationRef: "Oracle Database Performance Tuning Guide - Sizing the Buffer Cache",
  };
}

/**
 * ORCL-02: Excessive Redo Log Switching
 */
export function evaluateRedoLogSwitching(telemetry: OracleTelemetryInput): OracleRuleResult {
  const switches = telemetry.redoLogs?.switchesLastHour ?? telemetry.redoLogs?.currentSwitchRatePerHour ?? 0;
  let severity: DiagnosticSeverity = "OK";
  let triggered = false;
  let summary = `Redo log switch rate is optimal (${switches} switches/hour).`;

  if (switches > 12) {
    severity = "CRITICAL";
    triggered = true;
    summary = `Critical redo log switch rate (${switches}/hour > 12/hour). Frequent DBWR checkpoints and commit stalls.`;
  } else if (switches > 6) {
    severity = "WARNING";
    triggered = true;
    summary = `Elevated redo log switch rate (${switches}/hour > 6/hour). Checkpoint latency may impact write throughput.`;
  }

  return {
    ruleId: "ORCL-02",
    name: "Excessive Redo Log Switch Frequency",
    category: "Storage & Checkpoint Throughput",
    severity,
    triggered,
    metricValue: switches,
    threshold: severity === "CRITICAL" ? 12 : 6,
    unit: "switches/hr",
    targetResource: "Online Redo Log Groups",
    summary,
    rootCause: "Online Redo Log files are undersized for the current DML write volume, forcing frequent LGWR switches and continuous DBWR checkpoints.",
    impact: "Elevated log file sync and log file switch wait events, checkpoint storms, and increased I/O load on storage subsystem.",
    remediationSql: [
      "SELECT group#, bytes/(1024*1024) AS size_mb, status FROM v$log;",
      "ALTER DATABASE ADD LOGFILE GROUP 4 ('+DATA/ORCLCDB/ONLINELOG/redo04.log') SIZE 4G;",
      "ALTER DATABASE ADD LOGFILE GROUP 5 ('+DATA/ORCLCDB/ONLINELOG/redo05.log') SIZE 4G;",
      "ALTER SYSTEM SWITCH LOGFILE;",
      "ALTER SYSTEM CHECKPOINT;",
      "ALTER DATABASE DROP LOGFILE GROUP 1;",
    ],
    remediationActions: [
      "Add new 4GB or 8GB online redo log groups to achieve the optimal target of 2-4 switches per hour.",
      "Force log switches and checkpoints until old undersized groups become INACTIVE.",
      "Drop obsolete undersized redo log groups.",
    ],
    documentationRef: "Oracle Database Administrator Guide - Managing the Redo Log",
  };
}

/**
 * ORCL-03: PDB CPU Hogging / Resource Skew
 */
export function evaluatePdbCpuSkew(telemetry: OracleTelemetryInput): OracleRuleResult {
  const pdbs = telemetry.pdbs || [];
  if (!telemetry.isCdb || pdbs.length === 0) {
    return {
      ruleId: "ORCL-03",
      name: "Pluggable Database (PDB) CPU Skew & Starvation",
      category: "Multitenant Governance & CPU Allocation",
      severity: "OK",
      triggered: false,
      metricValue: 0,
      threshold: 70.0,
      unit: "%",
      targetResource: "CDB Resource Manager",
      summary: "Non-CDB standalone instance or no PDBs registered. Rule evaluated as OK.",
      rootCause: "N/A",
      impact: "N/A",
      remediationSql: [],
      remediationActions: [],
      documentationRef: "Oracle Database Administrator Guide - Managing Resource Allocation in CDB",
    };
  }

  // Find max CPU consuming PDB
  let maxPdb = pdbs[0];
  for (const pdb of pdbs) {
    if ((pdb.cpuSlicePct ?? 0) > (maxPdb.cpuSlicePct ?? 0)) {
      maxPdb = pdb;
    }
  }

  const maxCpu = maxPdb.cpuSlicePct ?? 0;
  const waitingSessions = maxPdb.avgWaitingSessions ?? 0;

  let severity: DiagnosticSeverity = "OK";
  let triggered = false;
  let summary = `PDB CPU distribution is balanced (highest: ${maxPdb.pdbName} at ${maxCpu.toFixed(1)}%).`;

  if (maxCpu > 85.0 || (maxCpu > 70.0 && waitingSessions > 0)) {
    severity = "CRITICAL";
    triggered = true;
    summary = `Critical PDB CPU hogging: ${maxPdb.pdbName} is consuming ${maxCpu.toFixed(1)}% CDB CPU with ${waitingSessions} waiting sessions, starving peer tenants.`;
  } else if (maxCpu > 70.0) {
    severity = "WARNING";
    triggered = true;
    summary = `Elevated PDB CPU skew: ${maxPdb.pdbName} is consuming ${maxCpu.toFixed(1)}% CDB CPU. Monitor for potential tenant starvation.`;
  }

  return {
    ruleId: "ORCL-03",
    name: "Pluggable Database (PDB) CPU Skew & Starvation",
    category: "Multitenant Governance & CPU Allocation",
    severity,
    triggered,
    metricValue: Number(maxCpu.toFixed(1)),
    threshold: severity === "CRITICAL" ? 85.0 : 70.0,
    unit: "%",
    targetResource: `PDB: ${maxPdb.pdbName}`,
    summary,
    rootCause: `Pluggable database ${maxPdb.pdbName} is executing unconstrained batch or CPU-intensive queries without active Resource Manager plan directives.`,
    impact: "Noisy neighbor effect starving co-hosted PDBs of CPU cycles, resulting in latency spikes across the CDB.",
    remediationSql: [
      "BEGIN\n" +
        "  DBMS_RESOURCE_MANAGER.CREATE_PENDING_AREA();\n" +
        `  DBMS_RESOURCE_MANAGER.UPDATE_PLAN_DIRECTIVE(\n` +
        `    plan => 'DEFAULT_CDB_PLAN',\n` +
        `    pluggable_database => '${maxPdb.pdbName}',\n` +
        "    shares => 100,\n" +
        "    utilization_limit => 50\n" +
        "  );\n" +
        "  DBMS_RESOURCE_MANAGER.SUBMIT_PENDING_AREA();\n" +
        "END;\n" +
        "/",
      "ALTER SYSTEM SET resource_manager_plan = 'DEFAULT_CDB_PLAN' SCOPE=BOTH;",
      `SELECT sid, serial#, username, sql_id FROM v$session WHERE con_id = ${maxPdb.conId} AND status = 'ACTIVE';`,
    ],
    remediationActions: [
      `Enforce a CDB Resource Manager Plan directive to cap ${maxPdb.pdbName} CPU utilization at 50%.`,
      "Activate CDB Resource Plan across the cluster.",
      `Investigate long-running queries inside ${maxPdb.pdbName} and terminate runaway sessions if necessary.`,
    ],
    documentationRef: "Oracle Multitenant Administrator Guide - Using Oracle Resource Manager with CDBs and PDBs",
  };
}

/**
 * ORCL-04: ASM Diskgroup Space Exhaustion
 */
export function evaluateAsmDiskgroupSpace(telemetry: OracleTelemetryInput): OracleRuleResult {
  const diskgroups = telemetry.asmDiskgroups || [];
  if (telemetry.asmEnabled === false || diskgroups.length === 0) {
    return {
      ruleId: "ORCL-04",
      name: "ASM Diskgroup Space Exhaustion Risk",
      category: "Storage Capacity & ASM Infrastructure",
      severity: "OK",
      triggered: false,
      metricValue: 100,
      threshold: 15.0,
      unit: "%",
      targetResource: "ASM Diskgroups",
      summary: "ASM is not enabled or no diskgroups configured. Rule evaluated as OK.",
      rootCause: "N/A",
      impact: "N/A",
      remediationSql: [],
      remediationActions: [],
      documentationRef: "Automatic Storage Management Administrator Guide - Managing ASM Diskgroups",
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
  let severity: DiagnosticSeverity = "OK";
  let triggered = false;
  let summary = `ASM Diskgroup space is healthy (lowest free: ${minDg.name} at ${freePct.toFixed(1)}% free).`;

  if (freePct < 5.0 || (minDg.usableFileMb !== undefined && minDg.usableFileMb <= 0)) {
    severity = "CRITICAL";
    triggered = true;
    summary = `Critical ASM space exhaustion on diskgroup ${minDg.name} (${freePct.toFixed(1)}% free < 5.0%). Imminent datafile extend failure.`;
  } else if (freePct < 15.0) {
    severity = "WARNING";
    triggered = true;
    summary = `Warning: Low free space on ASM diskgroup ${minDg.name} (${freePct.toFixed(1)}% free < 15.0%). Capacity expansion required.`;
  }

  return {
    ruleId: "ORCL-04",
    name: "ASM Diskgroup Space Exhaustion Risk",
    category: "Storage Capacity & ASM Infrastructure",
    severity,
    triggered,
    metricValue: Number(freePct.toFixed(1)),
    threshold: severity === "CRITICAL" ? 5.0 : 15.0,
    unit: "%",
    targetResource: `ASM Diskgroup: ${minDg.name.startsWith("+") ? minDg.name : "+" + minDg.name}`,
    summary,
    rootCause: `Diskgroup ${minDg.name} has consumed over ${(100 - freePct).toFixed(1)}% of capacity due to rapid datafile growth or unpurged archive logs.`,
    impact: "Inability to extend datafiles (ORA-01653), transaction rollbacks, or instance stall if archive destination is full (ORA-00257).",
    remediationSql: [
      `SELECT group_number, name, total_mb, free_mb, usable_file_mb FROM v$asm_diskgroup WHERE name = '${minDg.name.replace(/^\+/, "")}';`,
      `ALTER DISKGROUP ${minDg.name.replace(/^\+/, "")} ADD DISK '/dev/oracleasm/disks/DISK_NEW' REBALANCE POWER 8;`,
      "-- If FRA diskgroup, purge obsolete archive logs via RMAN:\n-- RMAN> BACKUP ARCHIVELOG ALL DELETE INPUT;",
    ],
    remediationActions: [
      `Provision and add new LUNs to diskgroup ${minDg.name} with rebalance power 8.`,
      "Purge obsolete RMAN backups and expired archivelogs if Fast Recovery Area (FRA) is impacted.",
      "Audit tablespace autoextend settings on datafiles located in this diskgroup.",
    ],
    documentationRef: "Automatic Storage Management Administrator Guide - Adding and Dropping Disks",
  };
}

/**
 * ORCL-05: Data Guard Replication Lag
 */
export function evaluateDataGuardLag(telemetry: OracleTelemetryInput): OracleRuleResult {
  const dg = telemetry.dataGuard;
  if (!dg || dg.configured === false || dg.enabled === false) {
    return {
      ruleId: "ORCL-05",
      name: "Data Guard Replication & Transport Lag Breach",
      category: "Disaster Recovery & High Availability",
      severity: "OK",
      triggered: false,
      metricValue: 0,
      threshold: 60,
      unit: "sec",
      targetResource: "Data Guard Standby",
      summary: "Data Guard is not configured on this instance. Rule evaluated as OK.",
      rootCause: "N/A",
      impact: "N/A",
      remediationSql: [],
      remediationActions: [],
      documentationRef: "Oracle Data Guard Concepts and Administration - Monitoring Data Guard",
    };
  }

  const applyLag = dg.applyLagSeconds ?? 0;
  const transportLag = dg.transportLagSeconds ?? 0;
  const hasGap = dg.gapStatus && dg.gapStatus !== "NONE";

  let severity: DiagnosticSeverity = "OK";
  let triggered = false;
  let summary = `Data Guard replication is synchronized (Apply lag: ${applyLag}s, Transport lag: ${transportLag}s).`;

  if (applyLag > 300 || hasGap) {
    severity = "CRITICAL";
    triggered = true;
    summary = `Critical Data Guard replication lag (${applyLag}s > 300s)${hasGap ? " with active redo sequence gap" : ""}. RPO SLA breach.`;
  } else if (applyLag > 60 || transportLag > 30) {
    severity = "WARNING";
    triggered = true;
    summary = `Data Guard replication lag warning (Apply lag: ${applyLag}s > 60s, Transport lag: ${transportLag}s).`;
  }

  return {
    ruleId: "ORCL-05",
    name: "Data Guard Replication & Transport Lag Breach",
    category: "Disaster Recovery & High Availability",
    severity,
    triggered,
    metricValue: applyLag,
    threshold: severity === "CRITICAL" ? 300 : 60,
    unit: "sec",
    targetResource: "Data Guard Standby Apply Process (MRP0)",
    summary,
    rootCause: hasGap
      ? "Redo sequence gap detected between Primary and Standby destination."
      : "Managed Recovery Process (MRP0) on Standby is lagging behind primary redo generation due to transport bandwidth or I/O bottleneck.",
    impact: "Increased Recovery Point Objective (RPO) and Recovery Time Objective (RTO) exposure in failover scenarios.",
    remediationSql: [
      "SELECT name, value, unit FROM v$dataguard_stats;",
      "SELECT dest_id, status, error, gap_status FROM v$archive_dest_status WHERE status != 'INACTIVE';",
      "ALTER DATABASE RECOVER MANAGED STANDBY DATABASE CANCEL;",
      "ALTER DATABASE RECOVER MANAGED STANDBY DATABASE DISCONNECT FROM SESSION PARALLEL 8 USING CURRENT LOGFILE;",
    ],
    remediationActions: [
      "Inspect standby alert log for ORA-00312, ORA-16014, or network timeout messages.",
      "Restart Managed Recovery Process (MRP0) with parallel apply workers.",
      "Tune Net8 Session Data Unit (SDU) sizing in sqlnet.ora (SDU=65535) for high-bandwidth redo transport.",
    ],
    documentationRef: "Oracle Data Guard Concepts and Administration - Tuning Redo Apply",
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
  const criticalCount = findings.filter((f) => f.severity === "CRITICAL").length;
  const warningCount = findings.filter((f) => f.severity === "WARNING").length;

  let overallHealth: "HEALTHY" | "WARNING" | "CRITICAL" = "HEALTHY";
  if (criticalCount > 0) overallHealth = "CRITICAL";
  else if (warningCount > 0) overallHealth = "WARNING";

  const remediationSummary = findings
    .filter((f) => f.triggered)
    .map((f) => `[${f.ruleId} ${f.severity}] ${f.targetResource}: ${f.remediationActions[0]}`);

  return {
    instanceName: telemetry.instanceName || "ORACLE_INSTANCE",
    databaseRole: telemetry.info?.databaseRole || telemetry.dataGuard?.dbRole || "PRIMARY",
    isCdb: telemetry.isCdb ?? false,
    overallHealth,
    evaluatedAt: new Date().toISOString(),
    findings,
    criticalCount,
    warningCount,
    remediationSummary,
  };
}

/**
 * Enriched Gemini AI DBA Prompt Builder for Oracle
 */
export function buildOracleGeminiPrompt(
  telemetry: OracleTelemetryInput,
  report: OracleDiagnosticReport,
  context?: { incidentContext?: string; query?: string; type?: string }
): string {
  const isSlowQuery = context?.type === "slow_query";

  return `You are a Senior Principal Oracle Certified Master DBA (19c/21c/23ai) specializing in high-availability enterprise architectures, Multitenant (CDB/PDB), and Exadata performance optimization.

### TARGET ENVIRONMENT CONTEXT:
- Instance Name: ${report.instanceName}
- Architecture: ${report.isCdb ? "Multitenant Container Database (CDB/PDB)" : "Standalone (Non-CDB)"}
- Database Role: ${report.databaseRole}
- Overall Sentinel Health Status: ${report.overallHealth}
- Evaluation Timestamp: ${report.evaluatedAt}

### TELEMETRY SNAPSHOT:
1. SGA & Memory:
   - Buffer Cache Hit Ratio: ${telemetry.sga?.bufferCacheHitRatio ?? telemetry.bufferHitRatio ?? 100}%
   - Buffer Cache Size: ${telemetry.sga?.bufferCacheMb ?? "N/A"} MB
   - Shared Pool Size: ${telemetry.sga?.sharedPoolMb ?? "N/A"} MB
2. Redo Log Switch Rate: ${telemetry.redoLogs?.switchesLastHour ?? 0} switches in the last hour (24h avg: ${telemetry.redoLogs?.avgSwitchesPerHour ?? 0}/hr)
3. Multitenant PDBs:
${(telemetry.pdbs || []).map((p) => `   - PDB: ${p.pdbName} (ConID: ${p.conId}) | CPU Util: ${p.cpuSlicePct}% | Waiting Sessions: ${p.avgWaitingSessions ?? 0}`).join("\n") || "   - None (Non-CDB)"}
4. ASM Diskgroups:
${(telemetry.asmDiskgroups || []).map((dg) => `   - ${dg.name}: Total ${dg.totalMb} MB, Free ${dg.freeMb} MB (${dg.freePct}% free)`).join("\n") || "   - ASM Not Configured"}
5. Data Guard Replication:
   - Configured: ${telemetry.dataGuard?.configured ? "YES" : "NO"}
   - Apply Lag: ${telemetry.dataGuard?.applyLagSeconds ?? 0}s | Transport Lag: ${telemetry.dataGuard?.transportLagSeconds ?? 0}s | Gap Status: ${telemetry.dataGuard?.gapStatus ?? "NONE"}
6. Active Wait Events:
${(telemetry.topWaitEvents || []).map((w) => `   - ${w.event} (${w.waitClass}): avg wait ${w.avgWaitMs}ms`).join("\n") || "   - No severe wait events active"}

### DETERMINISTIC HEURISTIC FINDINGS:
${report.findings.filter((f) => f.triggered).map((f) => `- [${f.ruleId} - ${f.severity}] ${f.name} on ${f.targetResource}: ${f.summary}`).join("\n") || "- All deterministic rule heuristics passed with zero threshold breaches."}

${
  isSlowQuery
    ? `### TARGET SLOW QUERY TO ANALYZE:
\`\`\`sql
${context?.query || "SELECT /*+ MONITOR */ * FROM v$session WHERE status = 'ACTIVE';"}
\`\`\`
`
    : `### INCIDENT CONTEXT:
${context?.incidentContext || "Proactive health inspection and anomaly diagnostic scan."}
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

/**
 * Deterministic Fallback Generator when Gemini API is offline
 */
export function buildDeterministicOracleFallback(
  telemetry: OracleTelemetryInput,
  report: OracleDiagnosticReport
): FallbackDiagnosticResponse {
  const triggered = report.findings.filter((f) => f.triggered);
  const recommendations: string[] = [];
  const sqlStatements: string[] = [];

  let analysisBody = `[DataPulse Sentinel Deterministic Oracle Diagnostics - Offline Rule Engine]
Target Instance: ${report.instanceName} (${report.isCdb ? "Multitenant CDB" : "Standalone"})
Database Role: ${report.databaseRole}
Health Status: ${report.overallHealth} (Critical: ${report.criticalCount}, Warnings: ${report.warningCount})
Evaluated At: ${report.evaluatedAt}\n\n`;

  if (triggered.length === 0) {
    analysisBody += `Key Findings:
1. All core Oracle subsystems (SGA buffer cache, redo log generation, PDB CPU balance, ASM storage, and Data Guard replication) are operating within healthy operating thresholds.
2. Zero active heuristic rule violations detected.

Recommended Action:
- Maintain current proactive polling intervals.
- Ensure automated daily RMAN archivelog backups and validation.`;

    recommendations.push(
      "All Oracle metrics healthy. Continue normal monitoring schedule.",
      "Verify daily RMAN backup completion in V$RMAN_BACKUP_JOB_DETAILS."
    );

    sqlStatements.push(`-- Oracle System Health Verification
SELECT instance_name, status, database_status, archiver FROM v$instance;
SELECT con_id, name, open_mode FROM v$pdbs;`);
  } else {
    analysisBody += `Active Diagnostic Findings:\n`;
    triggered.forEach((rule, idx) => {
      analysisBody += `\n${idx + 1}. [${rule.ruleId} ${rule.severity}] ${rule.name} on ${rule.targetResource}
   - Finding: ${rule.summary}
   - Root Cause: ${rule.rootCause}
   - Impact: ${rule.impact}\n`;

      recommendations.push(...rule.remediationActions);
      sqlStatements.push(...rule.remediationSql);
    });
  }

  return {
    analysis: analysisBody,
    recommendations: Array.from(new Set(recommendations)),
    suggestedSql: sqlStatements.join("\n\n"),
    overallHealth: report.overallHealth,
    ruleResults: report.findings,
    timestamp: report.evaluatedAt,
  };
}
