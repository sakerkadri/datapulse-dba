/**
 * Empirical Adversarial Challenger Verification Script (Final Round 2)
 * Path: scripts/verify_challenger_final_2.ts
 */

import assert from "node:assert/strict";
import {
  evaluateBufferCache,
  evaluateRedoLogSwitching,
  evaluatePdbCpuSkew,
  evaluateAsmDiskgroupSpace,
  evaluateDataGuardLag,
  evaluateOracleRules,
  buildDeterministicOracleFallback,
  buildOracleGeminiPrompt,
} from "../src/diagnostics/rules/oracleRules.js";
import { HostDBCorrelationService } from "../src/services/correlation/HostDBCorrelationService.js";
import { LinuxHostMetricParser } from "../src/collectors/host/LinuxHostMetricParser.js";
import { DBInstance } from "../src/types/dba.js";
import { HostMetricsSnapshot } from "../src/types/host.js";
import { OracleTelemetryInput } from "../src/types/oracle.js";

console.log("===============================================================================");
console.log("STARTING EMPIRICAL CHALLENGER FINAL 2 ADVERSARIAL VERIFICATION HARNESS");
console.log("===============================================================================\n");

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runTest(name: string, fn: () => void) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  [PASS] ${name}`);
  } catch (err: any) {
    failedTests++;
    console.error(`  [FAIL] ${name}: ${err.message}`);
    console.error(err.stack);
  }
}

// ============================================================================
// 1. 50+ PDB MULTITENANT SCALING & ROGUE NOISY NEIGHBOR ISOLATION
// ============================================================================
console.log("-------------------------------------------------------------------------------");
console.log("TEST SUITE 1: 50+ PDB MULTITENANT SCALING & ROGUE NOISY NEIGHBOR ISOLATION");
console.log("-------------------------------------------------------------------------------");

runTest("1.1 Scale to 50 PDBs with single rogue tenant (PDB_TENANT_37 at 91.5% CPU)", () => {
  const pdbs: any[] = [];
  for (let i = 3; i <= 52; i++) {
    const isRogue = i === 37;
    pdbs.push({
      conId: i,
      pdbName: `PDB_TENANT_${i}`,
      cpuSlicePct: isRogue ? 91.5 : 0.8,
      avgWaitingSessions: isRogue ? 5.2 : 0,
      activeSessions: isRogue ? 45 : 1,
      totalSessions: isRogue ? 120 : 5,
    });
  }

  const telemetry: OracleTelemetryInput = {
    instanceName: "CDB_50_TENANTS",
    isCdb: true,
    pdbs,
  };

  const res = evaluatePdbCpuSkew(telemetry);
  assert.strictEqual(res.triggered, true);
  assert.strictEqual(res.severity, "CRITICAL");
  assert.strictEqual(res.targetResource, "PDB: PDB_TENANT_37");
  assert.strictEqual(res.metricValue, 91.5);
  assert.ok(res.summary.includes("PDB_TENANT_37"));
  assert.ok(res.summary.includes("91.5%"));
  assert.ok(res.summary.includes("5.2 waiting sessions"));
});

runTest("1.2 Scale to 100 PDBs with single rogue tenant (PDB_TENANT_88 at 86.0% CPU)", () => {
  const pdbs: any[] = [];
  for (let i = 3; i <= 102; i++) {
    const isRogue = i === 88;
    pdbs.push({
      conId: i,
      pdbName: `PDB_TENANT_${i}`,
      cpuSlicePct: isRogue ? 86.0 : 0.3,
      avgWaitingSessions: 0,
      activeSessions: isRogue ? 30 : 1,
      totalSessions: 10,
    });
  }

  const telemetry: OracleTelemetryInput = {
    instanceName: "CDB_100_TENANTS",
    isCdb: true,
    pdbs,
  };

  const res = evaluatePdbCpuSkew(telemetry);
  assert.strictEqual(res.triggered, true);
  assert.strictEqual(res.severity, "CRITICAL"); // maxCpu > 85.0 -> CRITICAL
  assert.strictEqual(res.targetResource, "PDB: PDB_TENANT_88");
  assert.strictEqual(res.metricValue, 86.0);
});

runTest("1.3 CDB with 50 completely balanced PDBs (2.0% CPU each)", () => {
  const pdbs: any[] = [];
  for (let i = 3; i <= 52; i++) {
    pdbs.push({
      conId: i,
      pdbName: `PDB_TENANT_${i}`,
      cpuSlicePct: 2.0,
      avgWaitingSessions: 0,
      activeSessions: 2,
    });
  }

  const telemetry: OracleTelemetryInput = {
    instanceName: "CDB_BALANCED",
    isCdb: true,
    pdbs,
  };

  const res = evaluatePdbCpuSkew(telemetry);
  assert.strictEqual(res.triggered, false);
  assert.strictEqual(res.severity, "OK");
  assert.strictEqual(res.metricValue, 2.0);
});

runTest("1.4 Standalone Non-CDB instance (isCdb: false) with empty or populated PDB list", () => {
  const telemetryEmpty: OracleTelemetryInput = {
    instanceName: "NON_CDB_EMPTY",
    isCdb: false,
    pdbs: [],
  };
  const resEmpty = evaluatePdbCpuSkew(telemetryEmpty);
  assert.strictEqual(resEmpty.triggered, false);
  assert.strictEqual(resEmpty.severity, "OK");

  const telemetryPopulated: OracleTelemetryInput = {
    instanceName: "NON_CDB_IGNORED",
    isCdb: false,
    pdbs: [{ conId: 3, pdbName: "PDB_TEST", cpuSlicePct: 95.0 }],
  };
  const resPopulated = evaluatePdbCpuSkew(telemetryPopulated);
  assert.strictEqual(resPopulated.triggered, false);
  assert.strictEqual(resPopulated.severity, "OK");
});

runTest("1.5 PDB with 0 CPU and undefined fields handling", () => {
  const telemetry: OracleTelemetryInput = {
    instanceName: "CDB_SPARSE",
    isCdb: true,
    pdbs: [
      { conId: 3, pdbName: "PDB_EMPTY" },
      { conId: 4, pdbName: "PDB_ZERO", cpuSlicePct: 0, avgWaitingSessions: 0 },
    ],
  };

  const res = evaluatePdbCpuSkew(telemetry);
  assert.strictEqual(res.triggered, false);
  assert.strictEqual(res.severity, "OK");
  assert.strictEqual(res.metricValue, 0);
});

// ============================================================================
// 2. ORACLE RULE EVALUATION (ORCL-01 THROUGH ORCL-05) ON BOUNDARY THRESHOLDS
// ============================================================================
console.log("\n-------------------------------------------------------------------------------");
console.log("TEST SUITE 2: ORACLE RULE EVALUATION (ORCL-01 TO ORCL-05) BOUNDARY THRESHOLDS");
console.log("-------------------------------------------------------------------------------");

// --- ORCL-01: Buffer Cache Hit Ratio ---
runTest("2.1.1 ORCL-01: Hit Ratio >= 90.0% is OK", () => {
  const res100 = evaluateBufferCache({ sga: { bufferCacheHitRatio: 100.0 } });
  assert.strictEqual(res100.severity, "OK");
  assert.strictEqual(res100.triggered, false);
  assert.strictEqual(res100.metricValue, 100.0);

  const res90 = evaluateBufferCache({ sga: { bufferCacheHitRatio: 90.0 } });
  assert.strictEqual(res90.severity, "OK");
  assert.strictEqual(res90.triggered, false);
  assert.strictEqual(res90.metricValue, 90.0);
});

runTest("2.1.2 ORCL-01: Hit Ratio 80.0% <= ratio < 90.0% is WARNING", () => {
  const res89_9 = evaluateBufferCache({ sga: { bufferCacheHitRatio: 89.9 } });
  assert.strictEqual(res89_9.severity, "WARNING");
  assert.strictEqual(res89_9.triggered, true);
  assert.strictEqual(res89_9.metricValue, 89.9);

  const res80_0 = evaluateBufferCache({ sga: { bufferCacheHitRatio: 80.0 } });
  assert.strictEqual(res80_0.severity, "WARNING");
  assert.strictEqual(res80_0.triggered, true);
  assert.strictEqual(res80_0.metricValue, 80.0);
});

runTest("2.1.3 ORCL-01: Hit Ratio < 80.0% is CRITICAL", () => {
  const res79_9 = evaluateBufferCache({ sga: { bufferCacheHitRatio: 79.9 } });
  assert.strictEqual(res79_9.severity, "CRITICAL");
  assert.strictEqual(res79_9.triggered, true);
  assert.strictEqual(res79_9.metricValue, 79.9);

  const res0 = evaluateBufferCache({ sga: { bufferCacheHitRatio: 0.0 } });
  assert.strictEqual(res0.severity, "CRITICAL");
  assert.strictEqual(res0.triggered, true);
  assert.strictEqual(res0.metricValue, 0.0);
});

runTest("2.1.4 ORCL-01: Fallback bufferHitRatio property compatibility", () => {
  const resFallback = evaluateBufferCache({ bufferHitRatio: 75.0 });
  assert.strictEqual(resFallback.severity, "CRITICAL");
  assert.strictEqual(resFallback.triggered, true);
  assert.strictEqual(resFallback.metricValue, 75.0);

  const resDefault = evaluateBufferCache({});
  assert.strictEqual(resDefault.severity, "OK");
  assert.strictEqual(resDefault.triggered, false);
  assert.strictEqual(resDefault.metricValue, 100.0);
});

// --- ORCL-02: Redo Log Switching ---
runTest("2.2.1 ORCL-02: Switches <= 6 is OK", () => {
  const res0 = evaluateRedoLogSwitching({ redoLogs: { switchesLastHour: 0 } });
  assert.strictEqual(res0.severity, "OK");
  assert.strictEqual(res0.triggered, false);

  const res6 = evaluateRedoLogSwitching({ redoLogs: { switchesLastHour: 6 } });
  assert.strictEqual(res6.severity, "OK");
  assert.strictEqual(res6.triggered, false);
  assert.strictEqual(res6.metricValue, 6);
});

runTest("2.2.2 ORCL-02: Switches 7..12 is WARNING", () => {
  const res7 = evaluateRedoLogSwitching({ redoLogs: { switchesLastHour: 7 } });
  assert.strictEqual(res7.severity, "WARNING");
  assert.strictEqual(res7.triggered, true);
  assert.strictEqual(res7.metricValue, 7);

  const res12 = evaluateRedoLogSwitching({ redoLogs: { switchesLastHour: 12 } });
  assert.strictEqual(res12.severity, "WARNING");
  assert.strictEqual(res12.triggered, true);
  assert.strictEqual(res12.metricValue, 12);
});

runTest("2.2.3 ORCL-02: Switches > 12 is CRITICAL", () => {
  const res13 = evaluateRedoLogSwitching({ redoLogs: { switchesLastHour: 13 } });
  assert.strictEqual(res13.severity, "CRITICAL");
  assert.strictEqual(res13.triggered, true);
  assert.strictEqual(res13.metricValue, 13);

  const res30 = evaluateRedoLogSwitching({ redoLogs: { currentSwitchRatePerHour: 30 } });
  assert.strictEqual(res30.severity, "CRITICAL");
  assert.strictEqual(res30.triggered, true);
  assert.strictEqual(res30.metricValue, 30);
});

// --- ORCL-03: PDB CPU Skew ---
runTest("2.3.1 ORCL-03: CPU <= 70.0% is OK", () => {
  const res = evaluatePdbCpuSkew({
    isCdb: true,
    pdbs: [{ conId: 3, pdbName: "PDB1", cpuSlicePct: 70.0, avgWaitingSessions: 0 }],
  });
  assert.strictEqual(res.severity, "OK");
  assert.strictEqual(res.triggered, false);
  assert.strictEqual(res.metricValue, 70.0);
});

runTest("2.3.2 ORCL-03: CPU 70.1%..85.0% without waiting sessions is WARNING", () => {
  const res70_1 = evaluatePdbCpuSkew({
    isCdb: true,
    pdbs: [{ conId: 3, pdbName: "PDB1", cpuSlicePct: 70.1, avgWaitingSessions: 0 }],
  });
  assert.strictEqual(res70_1.severity, "WARNING");
  assert.strictEqual(res70_1.triggered, true);
  assert.strictEqual(res70_1.metricValue, 70.1);

  const res85_0 = evaluatePdbCpuSkew({
    isCdb: true,
    pdbs: [{ conId: 3, pdbName: "PDB1", cpuSlicePct: 85.0, avgWaitingSessions: 0 }],
  });
  assert.strictEqual(res85_0.severity, "WARNING");
  assert.strictEqual(res85_0.triggered, true);
  assert.strictEqual(res85_0.metricValue, 85.0);
});

runTest("2.3.3 ORCL-03: CPU > 70.0% with waiting sessions (>0) is CRITICAL", () => {
  const res = evaluatePdbCpuSkew({
    isCdb: true,
    pdbs: [{ conId: 3, pdbName: "PDB1", cpuSlicePct: 70.5, avgWaitingSessions: 1.0 }],
  });
  assert.strictEqual(res.severity, "CRITICAL");
  assert.strictEqual(res.triggered, true);
  assert.strictEqual(res.metricValue, 70.5);
});

runTest("2.3.4 ORCL-03: CPU > 85.0% without waiting sessions is CRITICAL", () => {
  const res = evaluatePdbCpuSkew({
    isCdb: true,
    pdbs: [{ conId: 3, pdbName: "PDB1", cpuSlicePct: 85.1, avgWaitingSessions: 0 }],
  });
  assert.strictEqual(res.severity, "CRITICAL");
  assert.strictEqual(res.triggered, true);
  assert.strictEqual(res.metricValue, 85.1);
});

// --- ORCL-04: ASM Diskgroup Space ---
runTest("2.4.1 ORCL-04: ASM disabled or empty diskgroups is OK", () => {
  const resDisabled = evaluateAsmDiskgroupSpace({ asmEnabled: false });
  assert.strictEqual(resDisabled.severity, "OK");
  assert.strictEqual(resDisabled.triggered, false);

  const resEmpty = evaluateAsmDiskgroupSpace({ asmEnabled: true, asmDiskgroups: [] });
  assert.strictEqual(resEmpty.severity, "OK");
  assert.strictEqual(resEmpty.triggered, false);
});

runTest("2.4.2 ORCL-04: Free space >= 15.0% and usableFileMb > 0 is OK", () => {
  const res = evaluateAsmDiskgroupSpace({
    asmEnabled: true,
    asmDiskgroups: [{ name: "+DATA", freePct: 15.0, usableFileMb: 1000 } as any],
  });
  assert.strictEqual(res.severity, "OK");
  assert.strictEqual(res.triggered, false);
  assert.strictEqual(res.metricValue, 15.0);
});

runTest("2.4.3 ORCL-04: Free space 5.0% <= free < 15.0% is WARNING", () => {
  const res14_9 = evaluateAsmDiskgroupSpace({
    asmEnabled: true,
    asmDiskgroups: [{ name: "+DATA", freePct: 14.9, usableFileMb: 500 } as any],
  });
  assert.strictEqual(res14_9.severity, "WARNING");
  assert.strictEqual(res14_9.triggered, true);
  assert.strictEqual(res14_9.metricValue, 14.9);

  const res5_0 = evaluateAsmDiskgroupSpace({
    asmEnabled: true,
    asmDiskgroups: [{ name: "+DATA", freePct: 5.0, usableFileMb: 500 } as any],
  });
  assert.strictEqual(res5_0.severity, "WARNING");
  assert.strictEqual(res5_0.triggered, true);
  assert.strictEqual(res5_0.metricValue, 5.0);
});

runTest("2.4.4 ORCL-04: Free space < 5.0% or usableFileMb <= 0 is CRITICAL", () => {
  const res4_9 = evaluateAsmDiskgroupSpace({
    asmEnabled: true,
    asmDiskgroups: [{ name: "+DATA", freePct: 4.9, usableFileMb: 500 } as any],
  });
  assert.strictEqual(res4_9.severity, "CRITICAL");
  assert.strictEqual(res4_9.triggered, true);
  assert.strictEqual(res4_9.metricValue, 4.9);

  const resUsableZero = evaluateAsmDiskgroupSpace({
    asmEnabled: true,
    asmDiskgroups: [{ name: "+DATA", freePct: 20.0, usableFileMb: 0 } as any],
  });
  assert.strictEqual(resUsableZero.severity, "CRITICAL");
  assert.strictEqual(resUsableZero.triggered, true);
});

// --- ORCL-05: Data Guard Replication Lag ---
runTest("2.5.1 ORCL-05: Not configured or disabled is OK", () => {
  const res = evaluateDataGuardLag({ dataGuard: { configured: false, enabled: false } as any });
  assert.strictEqual(res.severity, "OK");
  assert.strictEqual(res.triggered, false);
});

runTest("2.5.2 ORCL-05: Apply lag <= 60s, transport lag <= 30s, gap NONE is OK", () => {
  const res = evaluateDataGuardLag({
    dataGuard: {
      configured: true,
      enabled: true,
      applyLagSeconds: 60,
      transportLagSeconds: 30,
      gapStatus: "NONE",
    } as any,
  });
  assert.strictEqual(res.severity, "OK");
  assert.strictEqual(res.triggered, false);
  assert.strictEqual(res.metricValue, 60);
});

runTest("2.5.3 ORCL-05: Apply lag 61..300s or Transport lag > 30s is WARNING", () => {
  const resApplyWarn = evaluateDataGuardLag({
    dataGuard: {
      configured: true,
      enabled: true,
      applyLagSeconds: 61,
      transportLagSeconds: 10,
      gapStatus: "NONE",
    } as any,
  });
  assert.strictEqual(resApplyWarn.severity, "WARNING");
  assert.strictEqual(resApplyWarn.triggered, true);

  const resTransWarn = evaluateDataGuardLag({
    dataGuard: {
      configured: true,
      enabled: true,
      applyLagSeconds: 20,
      transportLagSeconds: 31,
      gapStatus: "NONE",
    } as any,
  });
  assert.strictEqual(resTransWarn.severity, "WARNING");
  assert.strictEqual(resTransWarn.triggered, true);
});

runTest("2.5.4 ORCL-05: Apply lag > 300s or gapStatus != NONE is CRITICAL", () => {
  const resCritLag = evaluateDataGuardLag({
    dataGuard: {
      configured: true,
      enabled: true,
      applyLagSeconds: 301,
      transportLagSeconds: 10,
      gapStatus: "NONE",
    } as any,
  });
  assert.strictEqual(resCritLag.severity, "CRITICAL");
  assert.strictEqual(resCritLag.triggered, true);

  const resCritGap = evaluateDataGuardLag({
    dataGuard: {
      configured: true,
      enabled: true,
      applyLagSeconds: 5,
      transportLagSeconds: 5,
      gapStatus: "SEQUENCE_GAP",
    } as any,
  });
  assert.strictEqual(resCritGap.severity, "CRITICAL");
  assert.strictEqual(resCritGap.triggered, true);
  assert.ok(resCritGap.summary.includes("active redo sequence gap"));
});

// ============================================================================
// 3. LINUX CPU TICK-DELTA CALCULATIONS ((Delta Active / Delta Total) * 100)
// ============================================================================
console.log("\n-------------------------------------------------------------------------------");
console.log("TEST SUITE 3: LINUX CPU TICK-DELTA CALCULATIONS");
console.log("-------------------------------------------------------------------------------");

runTest("3.1 Baseline sample initialization produces 0.0% CPU and stores initial tick", () => {
  const parser = new LinuxHostMetricParser();
  const raw1 = `===CPU===\ncpu  1000 100 500 8000 200 50 10 20 0 0\n===MEM===\n===DISK===\n===LOAD===\n===IO===\n===UPTIME===\n`;
  const snap1 = parser.parseBatchOutput("lnx-host-1", raw1);
  assert.strictEqual(snap1.cpuUsagePct, 0);
  assert.strictEqual(snap1.cpuBreakdown.userPct, 0);
  assert.strictEqual(snap1.cpuBreakdown.systemPct, 0);
  assert.strictEqual(snap1.cpuBreakdown.iowaitPct, 0);
});

runTest("3.2 Successive sample computes exact mathematical tick-delta ((deltaActive / deltaTotal) * 100)", () => {
  const parser = new LinuxHostMetricParser();
  // Sample 1:
  // user=1000, nice=100, sys=500, idle=8000, iowait=200, irq=50, softirq=10, steal=20
  // active = 1000 + 100 + 500 + 50 + 10 + 20 = 1680
  // total = 1680 + 8000 + 200 = 9880
  const raw1 = `===CPU===\ncpu  1000 100 500 8000 200 50 10 20 0 0\n===MEM===\n===DISK===\n===LOAD===\n===IO===\n===UPTIME===\n`;
  parser.parseBatchOutput("lnx-host-2", raw1);

  // Sample 2:
  // user=1500 (+500), nice=100 (+0), sys=700 (+200), idle=8800 (+800), iowait=600 (+400), irq=70 (+20), softirq=20 (+10), steal=40 (+20)
  // deltaActive = 500 + 0 + 200 + 20 + 10 + 20 = 750
  // deltaIdle = 800
  // deltaIowait = 400
  // deltaTotal = 750 + 800 + 400 = 1950
  // expected cpuUsagePct = (750 / 1950) * 100 = 38.4615... -> 38.5%
  // deltaUser = 500 / 1950 * 100 = 25.64% -> 25.6%
  // deltaSys = (200 + 20 + 10) / 1950 * 100 = 230 / 1950 * 100 = 11.79% -> 11.8%
  // deltaIowait = 400 / 1950 * 100 = 20.51% -> 20.5%
  // deltaSteal = 20 / 1950 * 100 = 1.02% -> 1.0%
  const raw2 = `===CPU===\ncpu  1500 100 700 8800 600 70 20 40 0 0\n===MEM===\n===DISK===\n===LOAD===\n===IO===\n===UPTIME===\n`;
  const snap2 = parser.parseBatchOutput("lnx-host-2", raw2);

  assert.strictEqual(snap2.cpuUsagePct, 38.5);
  assert.strictEqual(snap2.cpuBreakdown.userPct, 25.6);
  assert.strictEqual(snap2.cpuBreakdown.systemPct, 11.8);
  assert.strictEqual(snap2.cpuBreakdown.iowaitPct, 20.5);
  assert.strictEqual(snap2.cpuBreakdown.stealPct, 1.0);
});

runTest("3.3 100% idle delta produces exactly 0.0% CPU", () => {
  const parser = new LinuxHostMetricParser();
  const raw1 = `===CPU===\ncpu  100 0 50 850 0 0 0 0 0 0\n===MEM===\n===DISK===\n===LOAD===\n===IO===\n===UPTIME===\n`;
  parser.parseBatchOutput("lnx-idle", raw1);

  const raw2 = `===CPU===\ncpu  100 0 50 1850 0 0 0 0 0 0\n===MEM===\n===DISK===\n===LOAD===\n===IO===\n===UPTIME===\n`;
  const snap2 = parser.parseBatchOutput("lnx-idle", raw2);
  assert.strictEqual(snap2.cpuUsagePct, 0.0);
  assert.strictEqual(snap2.cpuBreakdown.userPct, 0.0);
});

runTest("3.4 100% active delta produces exactly 100.0% CPU", () => {
  const parser = new LinuxHostMetricParser();
  const raw1 = `===CPU===\ncpu  100 0 50 850 0 0 0 0 0 0\n===MEM===\n===DISK===\n===LOAD===\n===IO===\n===UPTIME===\n`;
  parser.parseBatchOutput("lnx-sat", raw1);

  const raw2 = `===CPU===\ncpu  600 0 550 850 0 0 0 0 0 0\n===MEM===\n===DISK===\n===LOAD===\n===IO===\n===UPTIME===\n`;
  const snap2 = parser.parseBatchOutput("lnx-sat", raw2);
  assert.strictEqual(snap2.cpuUsagePct, 100.0);
});

runTest("3.5 Reboot / counter wrap (current totalTime <= prev totalTime) resets safely to 0%", () => {
  const parser = new LinuxHostMetricParser();
  const raw1 = `===CPU===\ncpu  999999 0 555555 8888888 0 0 0 0 0 0\n===MEM===\n===DISK===\n===LOAD===\n===IO===\n===UPTIME===\n`;
  parser.parseBatchOutput("lnx-reboot", raw1);

  const raw2 = `===CPU===\ncpu  100 0 50 850 0 0 0 0 0 0\n===MEM===\n===DISK===\n===LOAD===\n===IO===\n===UPTIME===\n`;
  const snap2 = parser.parseBatchOutput("lnx-reboot", raw2);
  assert.strictEqual(snap2.cpuUsagePct, 0.0);
  assert.strictEqual(Number.isNaN(snap2.cpuUsagePct), false);
});

runTest("3.6 Identical successive sample (deltaTotal = 0) returns 0.0% without NaN", () => {
  const parser = new LinuxHostMetricParser();
  const raw = `===CPU===\ncpu  100 0 50 850 0 0 0 0 0 0\n===MEM===\n===DISK===\n===LOAD===\n===IO===\n===UPTIME===\n`;
  parser.parseBatchOutput("lnx-same", raw);
  const snap = parser.parseBatchOutput("lnx-same", raw);
  assert.strictEqual(snap.cpuUsagePct, 0.0);
  assert.strictEqual(Number.isNaN(snap.cpuUsagePct), false);
});

// ============================================================================
// 4. HOST-TO-DB CORRELATION RULES
// ============================================================================
console.log("\n-------------------------------------------------------------------------------");
console.log("TEST SUITE 4: HOST-TO-DB CORRELATION RULES EMPIRICAL EVALUATION");
console.log("-------------------------------------------------------------------------------");

const correlationService = new HostDBCorrelationService();

function createBaseDb(engine: string = "Oracle"): DBInstance {
  return {
    id: "db-test-01",
    name: "Production DB",
    engine: engine as any,
    version: "19.22",
    host: "srv-host-01",
    port: 1521,
    databaseName: "PRODDB",
    status: "ONLINE",
    uptimeSeconds: 100000,
    cpuUsage: 10.0,
    memoryUsage: 40.0,
    iops: 100,
    activeConnections: 5,
    maxConnections: 500,
    queryLatencyMs: 5.0,
    slowQueryCount: 0,
    diskFreeGb: 500,
    diskTotalGb: 1000,
    replicationLagSeconds: 0,
    bufferHitRatio: 99.0,
    deadlocksCount: 0,
    lastHealthCheck: new Date().toISOString(),
    engineSpecific: {},
  };
}

function createBaseHost(): HostMetricsSnapshot {
  return {
    hostId: "host-srv-01",
    timestamp: new Date().toISOString(),
    osType: "LINUX",
    cpu: {
      usagePercent: 20.0,
      userPercent: 15.0,
      systemPercent: 5.0,
      iowaitPercent: 1.0,
      stealPercent: 0,
      loadAvg: [0.5, 0.4, 0.3],
    },
    memory: {
      totalGb: 64,
      usedGb: 20,
      availableGb: 44,
      usedPercent: 31.2,
      swapTotalGb: 16,
      swapUsedGb: 0,
      swapUsedPercent: 0,
    },
    disks: [
      { filesystem: "/dev/sda1", totalGb: 100, usedGb: 30, availableGb: 70, usedPercent: 30, mountPoint: "/" },
    ],
    io: {
      totalIops: 200,
      readIops: 120,
      writeIops: 80,
      utilPercent: 15,
    },
  };
}

// --- RULE 1: NOISY_NEIGHBOR_CPU ---
runTest("4.1.1 NOISY_NEIGHBOR_CPU: Host CPU >= 85% and DB CPU < 30% triggers WARNING", () => {
  const db = createBaseDb();
  db.cpuUsage = 20.0;
  const host = createBaseHost();
  host.cpu.usagePercent = 88.0;

  const alerts = correlationService.evaluate(db, host);
  const noisy = alerts.find((a) => a.ruleId === "NOISY_NEIGHBOR_CPU");
  assert.ok(noisy);
  assert.strictEqual(noisy.severity, "warning");
  assert.strictEqual(noisy.metadata?.nonDbCpuPct, 68.0);
  assert.ok(noisy.description.includes("88%"));
  assert.ok(noisy.description.includes("20%"));
});

runTest("4.1.2 NOISY_NEIGHBOR_CPU: Host CPU >= 95% triggers CRITICAL escalation", () => {
  const db = createBaseDb();
  db.cpuUsage = 15.0;
  const host = createBaseHost();
  host.cpu.usagePercent = 96.0;

  const alerts = correlationService.evaluate(db, host);
  const noisy = alerts.find((a) => a.ruleId === "NOISY_NEIGHBOR_CPU");
  assert.ok(noisy);
  assert.strictEqual(noisy.severity, "critical");
});

runTest("4.1.3 NOISY_NEIGHBOR_CPU: Host CPU 84.9% (below threshold) triggers 0 alerts", () => {
  const db = createBaseDb();
  db.cpuUsage = 10.0;
  const host = createBaseHost();
  host.cpu.usagePercent = 84.9;

  const alerts = correlationService.evaluate(db, host);
  assert.strictEqual(alerts.filter((a) => a.ruleId === "NOISY_NEIGHBOR_CPU").length, 0);
});

// --- RULE 2: DB_QUERY_STORM ---
runTest("4.2.1 DB_QUERY_STORM: Host CPU >= 80%, DB CPU >= 70%, activeConns >= 20 triggers CRITICAL", () => {
  const db = createBaseDb("PostgreSQL");
  db.cpuUsage = 75.0;
  db.activeConnections = 25;
  const host = createBaseHost();
  host.cpu.usagePercent = 85.0;

  const alerts = correlationService.evaluate(db, host);
  const storm = alerts.find((a) => a.ruleId === "DB_QUERY_STORM");
  assert.ok(storm);
  assert.strictEqual(storm.severity, "critical");
});

runTest("4.2.2 DB_QUERY_STORM: Host CPU >= 80%, DB CPU >= 70%, latency >= 100ms triggers CRITICAL", () => {
  const db = createBaseDb("MySQL");
  db.cpuUsage = 72.0;
  db.activeConnections = 5;
  db.queryLatencyMs = 120.0;
  const host = createBaseHost();
  host.cpu.usagePercent = 82.0;

  const alerts = correlationService.evaluate(db, host);
  const storm = alerts.find((a) => a.ruleId === "DB_QUERY_STORM");
  assert.ok(storm);
  assert.strictEqual(storm.severity, "critical");
});

runTest("4.2.3 DB_QUERY_STORM: Oracle CDB with runaway PDB sessions (>= 20) isolates tenant", () => {
  const db = createBaseDb("Oracle");
  db.cpuUsage = 85.0;
  db.activeConnections = 10;
  db.queryLatencyMs = 20.0;
  db.engineSpecific = {
    oracle: {
      pdbs: [
        { conId: 3, pdbName: "PDB_SALES", activeSessions: 42 },
        { conId: 4, pdbName: "PDB_HR", activeSessions: 2 },
      ],
    } as any,
  };
  const host = createBaseHost();
  host.cpu.usagePercent = 90.0;

  const alerts = correlationService.evaluate(db, host);
  const storm = alerts.find((a) => a.ruleId === "DB_QUERY_STORM");
  assert.ok(storm);
  assert.strictEqual(storm.severity, "critical");
  assert.strictEqual(storm.metadata?.topPdb, "PDB_SALES");
  assert.ok(storm.description.includes("Primary tenant driver: PDB 'PDB_SALES' with 42 active sessions."));
});

// --- RULE 3: STORAGE_IOPS_BOTTLENECK ---
runTest("4.3.1 STORAGE_IOPS_BOTTLENECK: Host I/O util >= 80% with DB latency >= 100ms triggers CRITICAL", () => {
  const db = createBaseDb();
  db.queryLatencyMs = 150.0;
  const host = createBaseHost();
  host.io!.utilPercent = 85.0;

  const alerts = correlationService.evaluate(db, host);
  const ioAlert = alerts.find((a) => a.ruleId === "STORAGE_IOPS_BOTTLENECK");
  assert.ok(ioAlert);
  assert.strictEqual(ioAlert.severity, "critical");
});

runTest("4.3.2 STORAGE_IOPS_BOTTLENECK: Total IOPS >= 3000 with Oracle I/O wait event triggers CRITICAL", () => {
  const db = createBaseDb("Oracle");
  db.queryLatencyMs = 25.0;
  db.engineSpecific = {
    oracle: {
      topWaitEvents: [
        { event: "db file sequential read", waitClass: "User I/O", avgWaitMs: 30.0 },
      ],
    } as any,
  };
  const host = createBaseHost();
  host.io!.totalIops = 3500;
  host.io!.readIops = 2500;
  host.io!.writeIops = 1000;

  const alerts = correlationService.evaluate(db, host);
  const ioAlert = alerts.find((a) => a.ruleId === "STORAGE_IOPS_BOTTLENECK");
  assert.ok(ioAlert);
  assert.strictEqual(ioAlert.severity, "critical");
});

runTest("4.3.3 STORAGE_IOPS_BOTTLENECK: iowaitPct >= 20% with log file sync wait triggers CRITICAL", () => {
  const db = createBaseDb("Oracle");
  db.engineSpecific = {
    oracle: {
      topWaitEvents: [
        { event: "log file sync", waitClass: "Commit", avgWaitMs: 40.0 },
      ],
    } as any,
  };
  const host = createBaseHost();
  host.cpu.iowaitPercent = 25.0;

  const alerts = correlationService.evaluate(db, host);
  const ioAlert = alerts.find((a) => a.ruleId === "STORAGE_IOPS_BOTTLENECK");
  assert.ok(ioAlert);
  assert.strictEqual(ioAlert.severity, "critical");
});

// --- RULE 4: OS_MEMORY_SWAPPING ---
runTest("4.4.1 OS_MEMORY_SWAPPING: Host RAM used >= 90% and DB hit ratio < 90% triggers CRITICAL", () => {
  const db = createBaseDb("PostgreSQL");
  db.bufferHitRatio = 84.5;
  const host = createBaseHost();
  host.memory.usedPercent = 92.0;

  const alerts = correlationService.evaluate(db, host);
  const swapAlert = alerts.find((a) => a.ruleId === "OS_MEMORY_SWAPPING");
  assert.ok(swapAlert);
  assert.strictEqual(swapAlert.severity, "critical");
  assert.ok(swapAlert.description.includes("84.5%"));
});

runTest("4.4.2 OS_MEMORY_SWAPPING: Host Swap used >= 15% and DB hit ratio < 90% triggers CRITICAL", () => {
  const db = createBaseDb("MySQL");
  db.bufferHitRatio = 88.0;
  const host = createBaseHost();
  host.memory.swapUsedPercent = 18.0;

  const alerts = correlationService.evaluate(db, host);
  const swapAlert = alerts.find((a) => a.ruleId === "OS_MEMORY_SWAPPING");
  assert.ok(swapAlert);
  assert.strictEqual(swapAlert.severity, "critical");
});

runTest("4.4.3 OS_MEMORY_SWAPPING: Host RAM 95% but DB hit ratio 99% (healthy cache) triggers 0 alerts", () => {
  const db = createBaseDb("Oracle");
  db.bufferHitRatio = 99.5;
  const host = createBaseHost();
  host.memory.usedPercent = 95.0;

  const alerts = correlationService.evaluate(db, host);
  assert.strictEqual(alerts.filter((a) => a.ruleId === "OS_MEMORY_SWAPPING").length, 0);
});

// --- RULE 5: DISK_SPACE_EXHAUSTION ---
runTest("4.5.1 DISK_SPACE_EXHAUSTION: Host disk 85%..91% triggers WARNING", () => {
  const db = createBaseDb();
  const host = createBaseHost();
  host.disks = [
    { filesystem: "/dev/sdb1", totalGb: 500, usedGb: 440, availableGb: 60, usedPercent: 88, mountPoint: "/data" },
  ];

  const alerts = correlationService.evaluate(db, host);
  const diskAlert = alerts.find((a) => a.ruleId === "DISK_SPACE_EXHAUSTION");
  assert.ok(diskAlert);
  assert.strictEqual(diskAlert.severity, "warning");
  assert.ok(diskAlert.description.includes("/data"));
});

runTest("4.5.2 DISK_SPACE_EXHAUSTION: Host disk >= 92% triggers CRITICAL escalation", () => {
  const db = createBaseDb();
  const host = createBaseHost();
  host.disks = [
    { filesystem: "/dev/sdb1", totalGb: 500, usedGb: 475, availableGb: 25, usedPercent: 95, mountPoint: "/data" },
  ];

  const alerts = correlationService.evaluate(db, host);
  const diskAlert = alerts.find((a) => a.ruleId === "DISK_SPACE_EXHAUSTION");
  assert.ok(diskAlert);
  assert.strictEqual(diskAlert.severity, "critical");
});

runTest("4.5.3 DISK_SPACE_EXHAUSTION: Oracle non-autoextensible tablespace >= 90% triggers CRITICAL", () => {
  const db = createBaseDb("Oracle");
  db.engineSpecific = {
    oracle: {
      tablespaces: [
        { tablespaceName: "APP_DATA", usedPct: 92.5, autoextensible: false },
        { tablespaceName: "AUTO_DATA", usedPct: 96.0, autoextensible: true },
      ],
    } as any,
  };
  const host = createBaseHost();

  const alerts = correlationService.evaluate(db, host);
  const diskAlerts = alerts.filter((a) => a.ruleId === "DISK_SPACE_EXHAUSTION");
  assert.strictEqual(diskAlerts.length, 1);
  assert.strictEqual(diskAlerts[0].severity, "critical");
  assert.ok(diskAlerts[0].description.includes("APP_DATA"));
  assert.ok(diskAlerts[0].remediation.includes("ALTER TABLESPACE APP_DATA ADD DATAFILE"));
});

runTest("4.5.4 DISK_SPACE_EXHAUSTION: Oracle ASM diskgroup free space < 10% triggers CRITICAL", () => {
  const db = createBaseDb("Oracle");
  db.engineSpecific = {
    oracle: {
      asmDiskgroups: [
        { name: "+DATA", freePct: 6.5, state: "MOUNTED" },
        { name: "+FRA", freePct: 25.0, state: "MOUNTED" },
      ],
    } as any,
  };
  const host = createBaseHost();

  const alerts = correlationService.evaluate(db, host);
  const asmAlert = alerts.find((a) => a.ruleId === "DISK_SPACE_EXHAUSTION");
  assert.ok(asmAlert);
  assert.strictEqual(asmAlert.severity, "critical");
  assert.ok(asmAlert.description.includes("+DATA"));
  assert.ok(asmAlert.remediation.includes("ALTER DISKGROUP DATA ADD DISK"));
});

// ============================================================================
// SUMMARY REPORT
// ============================================================================
console.log("\n===============================================================================");
console.log(`TOTAL ADVERSARIAL TESTS: ${totalTests}`);
console.log(`PASSED: ${passedTests}`);
console.log(`FAILED: ${failedTests}`);
console.log("===============================================================================\n");

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
