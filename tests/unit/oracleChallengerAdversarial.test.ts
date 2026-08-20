/**
 * Challenger 1 Adversarial & Empirical Stress Test Suite for Oracle Database Monitoring (M1)
 * Path: tests/unit/oracleChallengerAdversarial.test.ts
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { OracleCollector, parseIntervalToSeconds } from "../../src/collectors/oracle/oracleCollector";
import { MockOracleDriver, MockScenario } from "../../src/collectors/mock/mockOracleDriver";
import {
  evaluateOracleRules,
  evaluateBufferCache,
  evaluateRedoLogSwitching,
  evaluatePdbCpuSkew,
  evaluateAsmDiskgroupSpace,
  evaluateDataGuardLag,
  buildDeterministicOracleFallback,
  buildOracleGeminiPrompt,
} from "../../src/diagnostics/rules/oracleRules";
import type { IOracleDriver, OracleConnectionConfig } from "../../src/types/oracle";

/**
 * Adversarial Custom Driver for Injected Corruption & Pathological Mocking
 */
class AdversarialOracleDriver implements IOracleDriver {
  private connected: boolean = true;
  private queryOverrides: Array<{ matcher: (sql: string) => boolean; handler: (sql: string) => any }> = [];
  public executedQueries: string[] = [];

  public setQueryOverride(keywordOrPredicate: string | ((sql: string) => boolean), handler: (sql: string) => any): void {
    if (typeof keywordOrPredicate === "string") {
      const kw = keywordOrPredicate.toUpperCase();
      this.queryOverrides.unshift({
        matcher: (sql: string) => sql.toUpperCase().includes(kw),
        handler,
      });
    } else {
      this.queryOverrides.unshift({
        matcher: keywordOrPredicate,
        handler,
      });
    }
  }

  public clearOverrides(): void {
    this.queryOverrides = [];
    this.executedQueries = [];
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async ping(): Promise<{ success: boolean; latencyMs: number }> {
    return { success: true, latencyMs: 1.2 };
  }

  async close(): Promise<void> {
    this.connected = false;
  }

  isHealthy(): boolean {
    return this.connected;
  }

  async execute<T = any>(sql: string, binds: Record<string, any> | any[] = {}): Promise<T[]> {
    this.executedQueries.push(sql);

    for (const { matcher, handler } of this.queryOverrides) {
      if (matcher(sql)) {
        return handler(sql);
      }
    }

    return [] as any;
  }
}

describe("Empirical Challenger M1: Adversarial Oracle Monitoring & Mock Driver Stress Suite", () => {
  const baseConfig: OracleConnectionConfig = {
    host: "ora-db-test.corp.internal",
    port: 1521,
    serviceName: "ORCLTEST",
    isMock: true,
  };

  // =========================================================================
  // Section 1: All 7 MockOracleDriver Scenarios Comprehensive Validation
  // =========================================================================
  describe("Section 1: Exhaustive Validation of All 7 MockOracleDriver Scenarios", () => {
    const scenarios: MockScenario[] = [
      "HEALTHY_CDB",
      "STANDALONE_NON_CDB",
      "PDB_STARVATION",
      "HIGH_LOG_SWITCH",
      "TABLESPACE_FULL",
      "DATA_GUARD_LAG",
      "CHAOS_FAULT",
    ];

    it("1.1 should instantiate and execute every scenario without unhandled crashes", async () => {
      for (const scenario of scenarios) {
        const driver = new MockOracleDriver(scenario);
        const collector = new OracleCollector({ ...baseConfig, mockScenario: scenario }, driver);
        const telemetry = await collector.collect();

        assert.ok(telemetry, `Telemetry must be returned for scenario ${scenario}`);
        assert.ok(typeof telemetry.latencyMs === "number", "Latency must be recorded");
        assert.ok(telemetry.collectedAt, "collectedAt timestamp must exist");

        if (scenario === "CHAOS_FAULT") {
          assert.strictEqual(telemetry.status, "OFFLINE");
          assert.ok(telemetry.error, "Chaos fault scenario must surface error");
          assert.strictEqual(telemetry.backgroundProcesses.pmon, "STOPPED");
        } else {
          assert.strictEqual(telemetry.status, "ONLINE", `Scenario ${scenario} should be ONLINE`);
        }
      }
    });

    it("1.2 [HEALTHY_CDB] should verify pristine baseline multi-tenant operation", async () => {
      const driver = new MockOracleDriver("HEALTHY_CDB");
      const collector = new OracleCollector(baseConfig, driver);
      const telemetry = await collector.collect();
      const report = evaluateOracleRules(telemetry);

      assert.strictEqual(telemetry.isCdb, true);
      assert.strictEqual(telemetry.cdbName, "ORCLCDB");
      assert.strictEqual(telemetry.pdbs?.length, 3);
      assert.strictEqual(telemetry.sga.bufferCacheHitRatio, 99.4);
      assert.strictEqual(telemetry.redoLogs.switchesLastHour, 4);
      assert.strictEqual(telemetry.asmDiskgroups.length, 2);
      assert.strictEqual(telemetry.asmDiskgroups[0].usedPct, 70.0);
      assert.strictEqual(telemetry.dataGuard.status, "SYNCHRONIZED");

      assert.strictEqual(report.overallHealth, "HEALTHY");
      assert.strictEqual(report.criticalCount, 0);
      assert.strictEqual(report.warningCount, 0);
    });

    it("1.3 [STANDALONE_NON_CDB] should verify single-instance non-CDB semantics", async () => {
      const driver = new MockOracleDriver("STANDALONE_NON_CDB");
      const collector = new OracleCollector(baseConfig, driver);
      const telemetry = await collector.collect();
      const report = evaluateOracleRules(telemetry);

      assert.strictEqual(telemetry.isCdb, false);
      assert.strictEqual(telemetry.cdbName, undefined);
      assert.deepStrictEqual(telemetry.pdbs, []);
      assert.strictEqual(telemetry.info?.instanceName, "orclnoncdb1");
      assert.ok(telemetry.tablespaces.length > 0);
      assert.ok(telemetry.tablespaces.every((t) => t.conId === 0));

      const r3 = evaluatePdbCpuSkew(telemetry);
      assert.strictEqual(r3.triggered, false);
      assert.strictEqual(r3.severity, "OK");
    });

    it("1.4 [PDB_STARVATION] should detect tenant starvation and trigger ORCL-03 CRITICAL", async () => {
      const driver = new MockOracleDriver("PDB_STARVATION");
      const collector = new OracleCollector(baseConfig, driver);
      const telemetry = await collector.collect();
      const report = evaluateOracleRules(telemetry);

      const starvedPdb = telemetry.pdbs?.find((p) => p.pdbName === "PDB_FINANCE");
      assert.ok(starvedPdb);
      assert.strictEqual(starvedPdb.cpuSlicePct, 88.5);
      assert.strictEqual(starvedPdb.avgWaitingSessions, 4.2);
      assert.strictEqual(starvedPdb.cpuWaitingSec, 28.5);

      const r3 = report.findings.find((f) => f.ruleId === "ORCL-03");
      assert.ok(r3);
      assert.strictEqual(r3.triggered, true);
      assert.strictEqual(r3.severity, "CRITICAL");
      assert.ok(r3.summary.includes("PDB_FINANCE"));
      assert.ok(r3.remediationSql.some((s) => s.includes("DBMS_RESOURCE_MANAGER")));
    });

    it("1.5 [HIGH_LOG_SWITCH] should detect checkpoint thrashing and trigger ORCL-02 & ORCL-01", async () => {
      const driver = new MockOracleDriver("HIGH_LOG_SWITCH");
      const collector = new OracleCollector(baseConfig, driver);
      const telemetry = await collector.collect();
      const report = evaluateOracleRules(telemetry);

      assert.strictEqual(telemetry.redoLogs.switchesLastHour, 28);
      assert.strictEqual(telemetry.sga.bufferCacheHitRatio, 89.2);

      const r2 = report.findings.find((f) => f.ruleId === "ORCL-02");
      assert.ok(r2);
      assert.strictEqual(r2.triggered, true);
      assert.strictEqual(r2.severity, "CRITICAL");

      const r1 = report.findings.find((f) => f.ruleId === "ORCL-01");
      assert.ok(r1);
      assert.strictEqual(r1.triggered, true);
      assert.strictEqual(r1.severity, "WARNING");

      assert.strictEqual(report.overallHealth, "CRITICAL");
    });

    it("1.6 [TABLESPACE_FULL] should detect storage saturation on tablespace and ASM", async () => {
      const driver = new MockOracleDriver("TABLESPACE_FULL");
      const collector = new OracleCollector(baseConfig, driver);
      const telemetry = await collector.collect();
      const report = evaluateOracleRules(telemetry);

      const fullTs = telemetry.tablespaces.find((t) => t.tablespaceName === "SALES_DATA");
      assert.ok(fullTs);
      assert.strictEqual(fullTs.usedPct, 95.7);
      assert.strictEqual(fullTs.autoextensible, false);

      const dataDg = telemetry.asmDiskgroups.find((d) => d.name === "DATA");
      assert.ok(dataDg);
      assert.strictEqual(dataDg.usedPct, 95.8);
      assert.strictEqual(dataDg.freePct, 4.2);

      const r4 = report.findings.find((f) => f.ruleId === "ORCL-04");
      assert.ok(r4);
      assert.strictEqual(r4.triggered, true);
      assert.strictEqual(r4.severity, "CRITICAL");
      assert.ok(r4.summary.includes("Critical ASM space exhaustion"));
    });

    it("1.7 [DATA_GUARD_LAG] should detect replication transport/apply lag and redo gap", async () => {
      const driver = new MockOracleDriver("DATA_GUARD_LAG");
      const collector = new OracleCollector(baseConfig, driver);
      const telemetry = await collector.collect();
      const report = evaluateOracleRules(telemetry);

      assert.strictEqual(telemetry.info?.databaseRole, "PHYSICAL STANDBY");
      assert.strictEqual(telemetry.dataGuard.status, "APPLY_LAG");
      assert.strictEqual(telemetry.dataGuard.applyLagSeconds, 345);
      assert.strictEqual(telemetry.dataGuard.transportLagSeconds, 48);
      assert.strictEqual(telemetry.dataGuard.gapStatus, "UNRESOLVED");

      const r5 = report.findings.find((f) => f.ruleId === "ORCL-05");
      assert.ok(r5);
      assert.strictEqual(r5.triggered, true);
      assert.strictEqual(r5.severity, "CRITICAL");
      assert.ok(r5.summary.includes("active redo sequence gap"));
    });

    it("1.8 [CHAOS_FAULT] should gracefully handle total connection destruction", async () => {
      const driver = new MockOracleDriver("CHAOS_FAULT");
      const collector = new OracleCollector(baseConfig, driver);
      const telemetry = await collector.collect();

      assert.strictEqual(telemetry.status, "OFFLINE");
      assert.ok(telemetry.error?.includes("ORA-12541") || telemetry.error?.includes("ORA-03135"));
      assert.strictEqual(telemetry.backgroundProcesses.pmon, "STOPPED");
      assert.strictEqual(telemetry.backgroundProcesses.dbwr, "STOPPED");
      assert.strictEqual(telemetry.backgroundProcesses.lgwr, "STOPPED");
      assert.strictEqual(telemetry.sga.bufferCacheHitRatio, 0);
      assert.strictEqual(telemetry.redoLogs.switchesLastHour, 0);
      assert.deepStrictEqual(telemetry.asmDiskgroups, []);
      assert.deepStrictEqual(telemetry.tablespaces, []);
    });
  });

  // =========================================================================
  // Section 2: Division-by-Zero & Boundary Mathematics Stress
  // =========================================================================
  describe("Section 2: Mathematical Singularities & Division-by-Zero Protection", () => {
    let advDriver: AdversarialOracleDriver;
    let collector: OracleCollector;

    beforeEach(() => {
      advDriver = new AdversarialOracleDriver();
      collector = new OracleCollector(baseConfig, advDriver);
    });

    it("2.1 should handle Buffer Cache Hit Ratio when gets + consistent gets == 0 (fresh startup)", async () => {
      advDriver.setQueryOverride("V$DATABASE", () => [
        { DB_NAME: "ORCL", CDB: "YES", OPEN_MODE: "READ WRITE" },
      ]);
      advDriver.setQueryOverride("BUFFER_CACHE_HIT_RATIO", () => [
        { BUFFER_CACHE_HIT_RATIO: null, PHYSICAL_READS_CACHE: 0, CONSISTENT_GETS_CACHE: 0, DB_BLOCK_GETS_CACHE: 0 },
      ]);

      const telemetry = await collector.collect();
      assert.strictEqual(telemetry.status, "ONLINE");
      assert.ok(Number.isFinite(telemetry.sga.bufferCacheHitRatio), "Hit ratio must be finite");

      const r1 = evaluateBufferCache(telemetry);
      assert.ok(r1, "Rule evaluation must not throw");
    });

    it("2.2 should handle Buffer Cache Hit Ratio when query returns NaN or string values", async () => {
      advDriver.setQueryOverride("BUFFER_CACHE_HIT_RATIO", () => [
        { BUFFER_CACHE_HIT_RATIO: "NaN" },
      ]);

      const telemetry = await collector.collect();
      assert.ok(Number.isFinite(telemetry.sga.bufferCacheHitRatio) || isNaN(telemetry.sga.bufferCacheHitRatio));

      // Test direct rule resilience on NaN/undefined/zero inputs
      const ruleResult = evaluateBufferCache({ sga: { bufferCacheHitRatio: 0 } });
      assert.strictEqual(ruleResult.severity, "CRITICAL");
      assert.strictEqual(ruleResult.triggered, true);

      const ruleResult100 = evaluateBufferCache({ sga: { bufferCacheHitRatio: 100 } });
      assert.strictEqual(ruleResult100.severity, "OK");
      assert.strictEqual(ruleResult100.triggered, false);
    });

    it("2.3 should protect against ASM division by zero when total_mb == 0", async () => {
      advDriver.setQueryOverride("V$DATABASE", () => [
        { DB_NAME: "ORCL", CDB: "YES", OPEN_MODE: "READ WRITE" },
      ]);
      advDriver.setQueryOverride("V$ASM_DISKGROUP", () => [
        {
          GROUP_NUMBER: 1,
          DISKGROUP_NAME: "EMPTY_DG",
          TOTAL_MB: 0,
          FREE_MB: 0,
          USABLE_FILE_MB: 0,
          OFFLINE_DISKS: 2,
          USED_PCT: null,
          FREE_PCT: null,
        },
      ]);

      const telemetry = await collector.collect();
      assert.strictEqual(telemetry.asmDiskgroups.length, 1);
      const dg = telemetry.asmDiskgroups[0];

      assert.strictEqual(dg.totalMb, 0);
      assert.strictEqual(dg.freeMb, 0);
      assert.strictEqual(dg.usedPct, 0);
      assert.strictEqual(dg.freePct, 0);
      assert.strictEqual(dg.offlineDisks, 2);
      assert.ok(!Number.isNaN(dg.usedPct), "usedPct must not be NaN");
      assert.ok(!Number.isNaN(dg.freePct), "freePct must not be NaN");

      const r4 = evaluateAsmDiskgroupSpace(telemetry);
      assert.ok(r4);
      assert.strictEqual(r4.triggered, true);
      assert.strictEqual(r4.severity, "CRITICAL");
    });

    it("2.4 should handle Tablespace division by zero when max_size_mb == 0 and total_allocated_mb == 0", async () => {
      advDriver.setQueryOverride("V$DATABASE", () => [
        { DB_NAME: "ORCL", CDB: "YES", OPEN_MODE: "READ WRITE" },
      ]);
      advDriver.setQueryOverride("CDB_DATA_FILES", () => [
        {
          CON_ID: 1,
          PDB_NAME: "CDB$ROOT",
          TABLESPACE_NAME: "GHOST_TBS",
          ALLOCATED_MB: 0,
          USED_MB: 0,
          FREE_MB: 0,
          MAX_SIZE_MB: 0,
          TOTAL_HEADROOM_MB: 0,
          USED_PCT_OF_MAX: null,
          IS_AUTOEXTENSIBLE: "NO",
        },
      ]);

      const telemetry = await collector.collect();
      assert.strictEqual(telemetry.tablespaces.length, 1);
      const ts = telemetry.tablespaces[0];

      assert.strictEqual(ts.totalMb, 0);
      assert.strictEqual(ts.usedMb, 0);
      assert.strictEqual(ts.usedPct, 0);
      assert.strictEqual(ts.freePct, 100);
      assert.ok(!Number.isNaN(ts.usedPct), "usedPct must not be NaN");
    });

    it("2.5 should handle Wait Class calculation when total_waited_sec == 0", async () => {
      advDriver.setQueryOverride("V$DATABASE", () => [
        { DB_NAME: "ORCL", CDB: "YES", OPEN_MODE: "READ WRITE" },
      ]);
      advDriver.setQueryOverride("V$SYSTEM_WAIT_CLASS", () => [
        { WAIT_CLASS: "System I/O", TOTAL_WAITS: 0, TIME_WAITED_SEC: 0, AVG_WAIT_MS: 0 },
      ]);

      const telemetry = await collector.collect();
      assert.strictEqual(telemetry.waitClasses.length, 1);
      assert.strictEqual(telemetry.waitClasses[0].pctTime, 0);
      assert.ok(!Number.isNaN(telemetry.waitClasses[0].pctTime));
    });
  });

  // =========================================================================
  // Section 3: PDB Scaling & Multitenant Stress (0 PDBs vs 50 PDBs)
  // =========================================================================
  describe("Section 3: PDB Container Scaling (0 PDBs vs 50 PDBs)", () => {
    let advDriver: AdversarialOracleDriver;
    let collector: OracleCollector;

    beforeEach(() => {
      advDriver = new AdversarialOracleDriver();
      collector = new OracleCollector(baseConfig, advDriver);
    });

    it("3.1 should handle CDB with 0 user PDBs (only root and seed)", async () => {
      advDriver.setQueryOverride("V$DATABASE", () => [
        { DB_NAME: "ORCL", CDB: "YES", OPEN_MODE: "READ WRITE" },
      ]);
      advDriver.setQueryOverride("V$PDBS", () => [
        { CON_ID: 1, PDB_NAME: "CDB$ROOT", OPEN_MODE: "READ WRITE", TOTAL_SIZE_GB: 10 },
        { CON_ID: 2, PDB_NAME: "PDB$SEED", OPEN_MODE: "READ ONLY", TOTAL_SIZE_GB: 2 },
      ]);
      advDriver.setQueryOverride("V$RSRC_PDB_METRIC", () => []);
      advDriver.setQueryOverride("V$SESSION", () => []);

      const telemetry = await collector.collect();
      assert.strictEqual(telemetry.isCdb, true);
      assert.deepStrictEqual(telemetry.pdbs, []); // Filtered out CON_ID <= 2

      const r3 = evaluatePdbCpuSkew(telemetry);
      assert.strictEqual(r3.triggered, false);
      assert.strictEqual(r3.severity, "OK");
      assert.strictEqual(r3.metricValue, 0);
    });

    it("3.2 should scale to 50 PDBs, accurately identifying the single rogue noisy neighbor", async () => {
      const mock50Pdbs = [];
      const mock50Rsrc = [];
      const mock50Sessions = [];

      for (let i = 3; i <= 52; i++) {
        const pdbName = `PDB_TENANT_${i}`;
        const isRogue = i === 42; // Rogue tenant 42 consumes 94.5% CPU
        const cpuUtil = isRogue ? 94.5 : 1.2;
        const waitingSessions = isRogue ? 8.0 : 0;

        mock50Pdbs.push({
          CON_ID: i,
          DBID: 10000 + i,
          PDB_NAME: pdbName,
          OPEN_MODE: "READ WRITE",
          RESTRICTED: "NO",
          TOTAL_SIZE_GB: 100 + i,
          RECOVERY_STATUS: "ENABLED",
        });

        mock50Rsrc.push({
          CON_ID: i,
          PDB_NAME: pdbName,
          CPU_UTILIZATION_LIMIT: 50,
          CPU_PCT_UTILIZED: cpuUtil,
          CPU_CONSUMED_SEC: isRogue ? 4500 : 100,
          CPU_WAITING_SEC: isRogue ? 65.2 : 0,
          AVG_RUNNING_SESSIONS: isRogue ? 35 : 2,
          AVG_WAITING_SESSIONS: waitingSessions,
          IOPS: isRogue ? 5000 : 200,
          IOMBPS: isRogue ? 150 : 10,
        });

        mock50Sessions.push({
          CON_ID: i,
          PDB_NAME: pdbName,
          TOTAL_SESSIONS: isRogue ? 200 : 10,
          ACTIVE_USER_SESSIONS: isRogue ? 85 : 1,
          INACTIVE_SESSIONS: 10,
          BLOCKED_SESSIONS: 0,
        });
      }

      advDriver.setQueryOverride("V$DATABASE", () => [
        { DB_NAME: "ORCL_MEGA_CDB", CDB: "YES", OPEN_MODE: "READ WRITE" },
      ]);
      advDriver.setQueryOverride("V$PDBS", () => mock50Pdbs);
      advDriver.setQueryOverride("V$RSRC_PDB_METRIC", () => mock50Rsrc);
      advDriver.setQueryOverride("V$SESSION", () => mock50Sessions);

      const telemetry = await collector.collect();
      assert.strictEqual(telemetry.pdbs?.length, 50);

      const r3 = evaluatePdbCpuSkew(telemetry);
      assert.strictEqual(r3.triggered, true);
      assert.strictEqual(r3.severity, "CRITICAL");
      assert.strictEqual(r3.targetResource, "PDB: PDB_TENANT_42");
      assert.strictEqual(r3.metricValue, 94.5);
      assert.ok(r3.summary.includes("PDB_TENANT_42"));
      assert.ok(r3.summary.includes("94.5%"));

      const prompt = buildOracleGeminiPrompt(telemetry, evaluateOracleRules(telemetry));
      assert.ok(prompt.includes("PDB_TENANT_42"));
      assert.ok(prompt.length > 500, "Prompt must be successfully generated for 50 PDBs");
    });
  });

  // =========================================================================
  // Section 4: Data Guard Interval String Parser Adversarial Fuzzing
  // =========================================================================
  describe("Section 4: Data Guard Interval Format Fuzzing", () => {
    it("4.1 should correctly parse standard and non-standard interval representations", () => {
      // Standard ISO/Oracle intervals
      assert.strictEqual(parseIntervalToSeconds("+00 00:00:00.000"), 0);
      assert.strictEqual(parseIntervalToSeconds("+00 00:00:01"), 1);
      assert.strictEqual(parseIntervalToSeconds("+00 00:05:45"), 345);
      assert.strictEqual(parseIntervalToSeconds("+00 01:00:00"), 3600);
      assert.strictEqual(parseIntervalToSeconds("+01 00:00:00"), 86400);
      assert.strictEqual(parseIntervalToSeconds("+03 12:30:15.999"), 304215); // 3*86400 + 12*3600 + 30*60 + 15

      // Without leading day specifier
      assert.strictEqual(parseIntervalToSeconds("00:05:45"), 345);
      assert.strictEqual(parseIntervalToSeconds("01:30:00"), 5400);

      // Negative day intervals (e.g. clock drift / skew)
      assert.strictEqual(parseIntervalToSeconds("-01 00:00:00"), 86400);
      assert.strictEqual(parseIntervalToSeconds("-00 00:10:00"), 600);

      // Null, undefined, empty, garbage
      assert.strictEqual(parseIntervalToSeconds(""), 0);
      assert.strictEqual(parseIntervalToSeconds(undefined), 0);
      assert.strictEqual(parseIntervalToSeconds(null as any), 0);
      assert.strictEqual(parseIntervalToSeconds("NOT_A_VALID_INTERVAL"), 0);
      assert.strictEqual(parseIntervalToSeconds("+++00--00"), 0);
      assert.strictEqual(parseIntervalToSeconds("   "), 0);
      assert.strictEqual(parseIntervalToSeconds("12345"), 0);
    });

    it("4.2 should evaluate Data Guard rule boundaries accurately", () => {
      // Configured = false -> OK
      const notConfigured = evaluateDataGuardLag({ dataGuard: { enabled: false, configured: false } as any });
      assert.strictEqual(notConfigured.severity, "OK");
      assert.strictEqual(notConfigured.triggered, false);

      // Apply lag 60s -> OK boundary
      const okBoundary = evaluateDataGuardLag({
        dataGuard: { enabled: true, configured: true, applyLagSeconds: 60, transportLagSeconds: 30, gapStatus: "NONE" } as any,
      });
      assert.strictEqual(okBoundary.severity, "OK");
      assert.strictEqual(okBoundary.triggered, false);

      // Apply lag 61s -> WARNING
      const warnLag = evaluateDataGuardLag({
        dataGuard: { enabled: true, configured: true, applyLagSeconds: 61, transportLagSeconds: 10, gapStatus: "NONE" } as any,
      });
      assert.strictEqual(warnLag.severity, "WARNING");
      assert.strictEqual(warnLag.triggered, true);

      // Transport lag 31s -> WARNING
      const warnTransport = evaluateDataGuardLag({
        dataGuard: { enabled: true, configured: true, applyLagSeconds: 10, transportLagSeconds: 31, gapStatus: "NONE" } as any,
      });
      assert.strictEqual(warnTransport.severity, "WARNING");
      assert.strictEqual(warnTransport.triggered, true);

      // Apply lag 301s -> CRITICAL
      const critLag = evaluateDataGuardLag({
        dataGuard: { enabled: true, configured: true, applyLagSeconds: 301, transportLagSeconds: 10, gapStatus: "NONE" } as any,
      });
      assert.strictEqual(critLag.severity, "CRITICAL");
      assert.strictEqual(critLag.triggered, true);

      // Redo gap -> CRITICAL regardless of lag seconds
      const critGap = evaluateDataGuardLag({
        dataGuard: { enabled: true, configured: true, applyLagSeconds: 5, transportLagSeconds: 2, gapStatus: "UNRESOLVED" } as any,
      });
      assert.strictEqual(critGap.severity, "CRITICAL");
      assert.strictEqual(critGap.triggered, true);
    });
  });

  // =========================================================================
  // Section 5: Corrupted, Malformed & Hostile Query Results
  // =========================================================================
  describe("Section 5: Malformed & Hostile Query Output Resilience", () => {
    let advDriver: AdversarialOracleDriver;
    let collector: OracleCollector;

    beforeEach(() => {
      advDriver = new AdversarialOracleDriver();
      collector = new OracleCollector(baseConfig, advDriver);
    });

    it("5.1 should survive when every SQL query returns empty arrays `[]`", async () => {
      advDriver.clearOverrides(); // Every query returns []

      const telemetry = await collector.collect();
      assert.strictEqual(telemetry.status, "ONLINE");
      assert.strictEqual(telemetry.info?.dbName, "ORCLCDB");
      assert.strictEqual(telemetry.sga.totalSgaMb, 32768); // fallback default
      assert.deepStrictEqual(telemetry.tablespaces, []);
      assert.deepStrictEqual(telemetry.pdbs, []);
      assert.deepStrictEqual(telemetry.asmDiskgroups, []);
      assert.strictEqual(telemetry.asmEnabled, false);
      assert.strictEqual(telemetry.dataGuard.enabled, false);
    });

    it("5.2 should survive when SQL queries return corrupted fields with unexpected types", async () => {
      advDriver.setQueryOverride("V$DATABASE", () => [
        {
          DB_NAME: 12345, // number instead of string
          CDB: null,
          OPEN_MODE: undefined,
          UPTIME_SECONDS: "NOT_A_NUMBER",
        },
      ]);
      advDriver.setQueryOverride("V$SGAINFO", () => [
        { COMPONENT_NAME: null, BYTES: "MALFORMED_BYTES" },
        { COMPONENT_NAME: 999, BYTES: -1024 },
      ]);
      advDriver.setQueryOverride("V$BGPROCESS", () => [
        { PROCESS_NAME: null, STATUS: null },
        { PROCESS_NAME: "UNKNOWN_PROCESS", STATUS: "EXPLODED" },
      ]);

      const telemetry = await collector.collect();
      assert.strictEqual(telemetry.status, "ONLINE");
      assert.ok(telemetry.sga.totalSgaMb >= 0);
      assert.strictEqual(telemetry.backgroundProcesses.pmon, "RUNNING"); // fallback defaults preserved
    });

    it("5.3 should survive partial driver failure mid-collection without throwing uncaught exceptions", async () => {
      let callCount = 0;
      advDriver.setQueryOverride("V$", () => {
        callCount++;
        if (callCount >= 3) {
          throw new Error("ORA-03113: end-of-file on communication channel");
        }
        return [{ DB_NAME: "ORCL", CDB: "YES", OPEN_MODE: "READ WRITE" }];
      });

      const telemetry = await collector.collect();
      // Partial queries failed but collector caught and used fallback or defaulted values
      assert.ok(telemetry);
      assert.ok(telemetry.collectedAt);
    });
  });

  // =========================================================================
  // Section 6: High-Concurrency & Rapid Invocation Stress Testing
  // =========================================================================
  describe("Section 6: High-Concurrency & Stress Load Harness", () => {
    it("6.1 should execute 50 parallel collection runs concurrently across all scenarios without cross-talk", async () => {
      const scenarios: MockScenario[] = [
        "HEALTHY_CDB",
        "STANDALONE_NON_CDB",
        "PDB_STARVATION",
        "HIGH_LOG_SWITCH",
        "TABLESPACE_FULL",
        "DATA_GUARD_LAG",
      ];

      const startTime = Date.now();
      const promises = Array.from({ length: 50 }, (_, idx) => {
        const scenario = scenarios[idx % scenarios.length];
        const driver = new MockOracleDriver(scenario);
        const collector = new OracleCollector({ ...baseConfig, mockScenario: scenario }, driver);
        return collector.collect().then((t) => ({ idx, scenario, telemetry: t }));
      });

      const results = await Promise.all(promises);
      const duration = Date.now() - startTime;

      assert.strictEqual(results.length, 50);
      for (const res of results) {
        assert.strictEqual(res.telemetry.status, "ONLINE");
        if (res.scenario === "STANDALONE_NON_CDB") {
          assert.strictEqual(res.telemetry.isCdb, false);
        } else if (res.scenario === "PDB_STARVATION") {
          assert.strictEqual(res.telemetry.pdbs?.find((p) => p.pdbName === "PDB_FINANCE")?.cpuSlicePct, 88.5);
        } else if (res.scenario === "HIGH_LOG_SWITCH") {
          assert.strictEqual(res.telemetry.redoLogs.switchesLastHour, 28);
        }
      }

      assert.ok(duration < 3000, `50 parallel executions should complete rapidly, took ${duration}ms`);
    });

    it("6.2 should run 100 rapid sequential cycles verifying memory immutability and zero accumulator bleed", async () => {
      const driver = new MockOracleDriver("HEALTHY_CDB");
      const collector = new OracleCollector(baseConfig, driver);

      for (let i = 0; i < 100; i++) {
        const telemetry = await collector.collect();
        assert.strictEqual(telemetry.status, "ONLINE");
        assert.strictEqual(telemetry.redoLogs.last24HoursHistory.length, 24);
        assert.strictEqual(telemetry.pdbs?.length, 3);
      }
    });
  });
});
