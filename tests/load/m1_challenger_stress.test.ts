import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateBufferCache,
  evaluateRedoLogSwitching,
  evaluatePdbCpuSkew,
  evaluateAsmDiskgroupSpace,
  evaluateDataGuardLag,
  evaluateOracleRules,
  buildOracleGeminiPrompt,
  buildDeterministicOracleFallback,
  OracleTelemetryInput,
} from "../../src/diagnostics/rules/oracleRules";
import {
  MOCK_ORACLE_CDB_METRICS,
  MOCK_ORACLE_STANDALONE_METRICS,
  INITIAL_DATABASES,
} from "../../src/mock/dbaData";
import { OracleEngineMetrics } from "../../src/types/oracle";

describe("Milestone 1 Adversarial Empirical Challenge Suite (Challenger 2)", () => {
  // -------------------------------------------------------------------------
  // 1. Strict Boundary Verification for ORCL-01 to ORCL-05
  // -------------------------------------------------------------------------
  describe("1. Heuristic Rule Strict Boundary Value Testing", () => {
    describe("ORCL-01: Buffer Cache Hit Ratio Strict Thresholds", () => {
      it("Boundary: 90.0% exactly must be clean (OK)", () => {
        const res = evaluateBufferCache({ sga: { bufferCacheHitRatio: 90.0 } });
        assert.strictEqual(res.severity, "OK");
        assert.strictEqual(res.triggered, false);
        assert.strictEqual(res.metricValue, 90.0);
      });

      it("Boundary: 89.9% must trigger WARNING", () => {
        const res = evaluateBufferCache({ sga: { bufferCacheHitRatio: 89.9 } });
        assert.strictEqual(res.severity, "WARNING");
        assert.strictEqual(res.triggered, true);
        assert.strictEqual(res.threshold, 90.0);
        assert.strictEqual(res.metricValue, 89.9);
      });

      it("Boundary: 80.0% exactly must trigger WARNING (not CRITICAL)", () => {
        const res = evaluateBufferCache({ sga: { bufferCacheHitRatio: 80.0 } });
        assert.strictEqual(res.severity, "WARNING");
        assert.strictEqual(res.triggered, true);
        assert.strictEqual(res.threshold, 90.0);
        assert.strictEqual(res.metricValue, 80.0);
      });

      it("Boundary: 79.9% must trigger CRITICAL", () => {
        const res = evaluateBufferCache({ sga: { bufferCacheHitRatio: 79.9 } });
        assert.strictEqual(res.severity, "CRITICAL");
        assert.strictEqual(res.triggered, true);
        assert.strictEqual(res.threshold, 80.0);
        assert.strictEqual(res.metricValue, 79.9);
      });

      it("Fallback: bufferHitRatio at top level is respected if sga is omitted", () => {
        const res = evaluateBufferCache({ bufferHitRatio: 89.9 });
        assert.strictEqual(res.severity, "WARNING");
        assert.strictEqual(res.triggered, true);
      });

      it("Extreme values: 0% is CRITICAL, 100% is OK", () => {
        const res0 = evaluateBufferCache({ sga: { bufferCacheHitRatio: 0 } });
        assert.strictEqual(res0.severity, "CRITICAL");
        const res100 = evaluateBufferCache({ sga: { bufferCacheHitRatio: 100 } });
        assert.strictEqual(res100.severity, "OK");
      });
    });

    describe("ORCL-02: Redo Log Switches Strict Thresholds", () => {
      it("Boundary: 6.0 switches/hr exactly must be clean (OK)", () => {
        const res = evaluateRedoLogSwitching({ redoLogs: { switchesLastHour: 6.0 } as any });
        assert.strictEqual(res.severity, "OK");
        assert.strictEqual(res.triggered, false);
        assert.strictEqual(res.metricValue, 6.0);
      });

      it("Boundary: 6.1 switches/hr must trigger WARNING", () => {
        const res = evaluateRedoLogSwitching({ redoLogs: { switchesLastHour: 6.1 } as any });
        assert.strictEqual(res.severity, "WARNING");
        assert.strictEqual(res.triggered, true);
        assert.strictEqual(res.threshold, 6);
        assert.strictEqual(res.metricValue, 6.1);
      });

      it("Boundary: 12.0 switches/hr exactly must trigger WARNING (not CRITICAL)", () => {
        const res = evaluateRedoLogSwitching({ redoLogs: { switchesLastHour: 12.0 } as any });
        assert.strictEqual(res.severity, "WARNING");
        assert.strictEqual(res.triggered, true);
        assert.strictEqual(res.threshold, 6);
        assert.strictEqual(res.metricValue, 12.0);
      });

      it("Boundary: 12.1 switches/hr must trigger CRITICAL", () => {
        const res = evaluateRedoLogSwitching({ redoLogs: { switchesLastHour: 12.1 } as any });
        assert.strictEqual(res.severity, "CRITICAL");
        assert.strictEqual(res.triggered, true);
        assert.strictEqual(res.threshold, 12);
        assert.strictEqual(res.metricValue, 12.1);
      });

      it("Fallback: currentSwitchRatePerHour is used if switchesLastHour is missing", () => {
        const res = evaluateRedoLogSwitching({ redoLogs: { currentSwitchRatePerHour: 8.5 } as any });
        assert.strictEqual(res.severity, "WARNING");
        assert.strictEqual(res.triggered, true);
      });
    });

    describe("ORCL-03: PDB CPU Skew Strict Thresholds", () => {
      it("Boundary: 70.0% CPU with 0 waiting sessions must be clean (OK)", () => {
        const res = evaluatePdbCpuSkew({
          isCdb: true,
          pdbs: [{ conId: 3, pdbName: "PDB1", cpuSlicePct: 70.0, avgWaitingSessions: 0 } as any],
        });
        assert.strictEqual(res.severity, "OK");
        assert.strictEqual(res.triggered, false);
        assert.strictEqual(res.metricValue, 70.0);
      });

      it("Boundary: 70.1% CPU with 0 waiting sessions must trigger WARNING", () => {
        const res = evaluatePdbCpuSkew({
          isCdb: true,
          pdbs: [{ conId: 3, pdbName: "PDB1", cpuSlicePct: 70.1, avgWaitingSessions: 0 } as any],
        });
        assert.strictEqual(res.severity, "WARNING");
        assert.strictEqual(res.triggered, true);
        assert.strictEqual(res.threshold, 70.0);
        assert.strictEqual(res.metricValue, 70.1);
      });

      it("Boundary: 85.0% CPU with 0 waiting sessions must trigger WARNING", () => {
        const res = evaluatePdbCpuSkew({
          isCdb: true,
          pdbs: [{ conId: 3, pdbName: "PDB1", cpuSlicePct: 85.0, avgWaitingSessions: 0 } as any],
        });
        assert.strictEqual(res.severity, "WARNING");
        assert.strictEqual(res.triggered, true);
        assert.strictEqual(res.threshold, 70.0);
        assert.strictEqual(res.metricValue, 85.0);
      });

      it("Boundary: 85.1% CPU with 0 waiting sessions must trigger CRITICAL", () => {
        const res = evaluatePdbCpuSkew({
          isCdb: true,
          pdbs: [{ conId: 3, pdbName: "PDB1", cpuSlicePct: 85.1, avgWaitingSessions: 0 } as any],
        });
        assert.strictEqual(res.severity, "CRITICAL");
        assert.strictEqual(res.triggered, true);
        assert.strictEqual(res.threshold, 85.0);
        assert.strictEqual(res.metricValue, 85.1);
      });

      it("Secondary trigger: 70.1% CPU with waiting sessions > 0 must trigger CRITICAL", () => {
        const res = evaluatePdbCpuSkew({
          isCdb: true,
          pdbs: [{ conId: 3, pdbName: "PDB_STARVED", cpuSlicePct: 70.1, avgWaitingSessions: 1.5 } as any],
        });
        assert.strictEqual(res.severity, "CRITICAL");
        assert.strictEqual(res.triggered, true);
      });

      it("Standalone instance (isCdb: false) or empty pdbs array must return OK", () => {
        const res1 = evaluatePdbCpuSkew({ isCdb: false, pdbs: [{ cpuSlicePct: 99.0 } as any] });
        assert.strictEqual(res1.severity, "OK");
        assert.strictEqual(res1.triggered, false);

        const res2 = evaluatePdbCpuSkew({ isCdb: true, pdbs: [] });
        assert.strictEqual(res2.severity, "OK");
        assert.strictEqual(res2.triggered, false);
      });
    });

    describe("ORCL-04: ASM Diskgroup Space Strict Thresholds", () => {
      it("Boundary: 15.0% free exactly (usableFileMb > 0) must be clean (OK)", () => {
        const res = evaluateAsmDiskgroupSpace({
          asmEnabled: true,
          asmDiskgroups: [{ name: "+DATA", freePct: 15.0, usableFileMb: 1000 } as any],
        });
        assert.strictEqual(res.severity, "OK");
        assert.strictEqual(res.triggered, false);
        assert.strictEqual(res.metricValue, 15.0);
      });

      it("Boundary: 14.9% free (usableFileMb > 0) must trigger WARNING", () => {
        const res = evaluateAsmDiskgroupSpace({
          asmEnabled: true,
          asmDiskgroups: [{ name: "+DATA", freePct: 14.9, usableFileMb: 1000 } as any],
        });
        assert.strictEqual(res.severity, "WARNING");
        assert.strictEqual(res.triggered, true);
        assert.strictEqual(res.threshold, 15.0);
        assert.strictEqual(res.metricValue, 14.9);
      });

      it("Boundary: 5.0% free (usableFileMb > 0) must trigger WARNING (not CRITICAL)", () => {
        const res = evaluateAsmDiskgroupSpace({
          asmEnabled: true,
          asmDiskgroups: [{ name: "+DATA", freePct: 5.0, usableFileMb: 1000 } as any],
        });
        assert.strictEqual(res.severity, "WARNING");
        assert.strictEqual(res.triggered, true);
        assert.strictEqual(res.threshold, 15.0);
        assert.strictEqual(res.metricValue, 5.0);
      });

      it("Boundary: 4.9% free must trigger CRITICAL", () => {
        const res = evaluateAsmDiskgroupSpace({
          asmEnabled: true,
          asmDiskgroups: [{ name: "+DATA", freePct: 4.9, usableFileMb: 1000 } as any],
        });
        assert.strictEqual(res.severity, "CRITICAL");
        assert.strictEqual(res.triggered, true);
        assert.strictEqual(res.threshold, 5.0);
        assert.strictEqual(res.metricValue, 4.9);
      });

      it("Secondary trigger: usableFileMb <= 0 triggers CRITICAL even if freePct >= 15%", () => {
        const res = evaluateAsmDiskgroupSpace({
          asmEnabled: true,
          asmDiskgroups: [{ name: "+DATA", freePct: 25.0, usableFileMb: 0 } as any],
        });
        assert.strictEqual(res.severity, "CRITICAL");
        assert.strictEqual(res.triggered, true);
      });

      it("ASM disabled (asmEnabled: false) or empty diskgroups must return OK", () => {
        const res1 = evaluateAsmDiskgroupSpace({ asmEnabled: false, asmDiskgroups: [{ freePct: 1.0 } as any] });
        assert.strictEqual(res1.severity, "OK");
        assert.strictEqual(res1.triggered, false);

        const res2 = evaluateAsmDiskgroupSpace({ asmEnabled: true, asmDiskgroups: [] });
        assert.strictEqual(res2.severity, "OK");
      });
    });

    describe("ORCL-05: Data Guard Replication Lag Strict Thresholds", () => {
      it("Boundary: 60s apply lag exactly (transportLag: 0, gap: NONE) must be clean (OK)", () => {
        const res = evaluateDataGuardLag({
          dataGuard: { enabled: true, configured: true, applyLagSeconds: 60, transportLagSeconds: 0, gapStatus: "NONE" } as any,
        });
        assert.strictEqual(res.severity, "OK");
        assert.strictEqual(res.triggered, false);
        assert.strictEqual(res.metricValue, 60);
      });

      it("Boundary: 61s apply lag must trigger WARNING", () => {
        const res = evaluateDataGuardLag({
          dataGuard: { enabled: true, configured: true, applyLagSeconds: 61, transportLagSeconds: 0, gapStatus: "NONE" } as any,
        });
        assert.strictEqual(res.severity, "WARNING");
        assert.strictEqual(res.triggered, true);
        assert.strictEqual(res.threshold, 60);
        assert.strictEqual(res.metricValue, 61);
      });

      it("Boundary: 300s apply lag exactly must trigger WARNING (not CRITICAL)", () => {
        const res = evaluateDataGuardLag({
          dataGuard: { enabled: true, configured: true, applyLagSeconds: 300, transportLagSeconds: 0, gapStatus: "NONE" } as any,
        });
        assert.strictEqual(res.severity, "WARNING");
        assert.strictEqual(res.triggered, true);
        assert.strictEqual(res.threshold, 60);
        assert.strictEqual(res.metricValue, 300);
      });

      it("Boundary: 301s apply lag must trigger CRITICAL", () => {
        const res = evaluateDataGuardLag({
          dataGuard: { enabled: true, configured: true, applyLagSeconds: 301, transportLagSeconds: 0, gapStatus: "NONE" } as any,
        });
        assert.strictEqual(res.severity, "CRITICAL");
        assert.strictEqual(res.triggered, true);
        assert.strictEqual(res.threshold, 300);
        assert.strictEqual(res.metricValue, 301);
      });

      it("Secondary triggers: transportLag > 30s triggers WARNING; gapStatus != NONE triggers CRITICAL", () => {
        const resTransport = evaluateDataGuardLag({
          dataGuard: { enabled: true, configured: true, applyLagSeconds: 10, transportLagSeconds: 31, gapStatus: "NONE" } as any,
        });
        assert.strictEqual(resTransport.severity, "WARNING");

        const resGap = evaluateDataGuardLag({
          dataGuard: { enabled: true, configured: true, applyLagSeconds: 5, transportLagSeconds: 0, gapStatus: "GAP_PRESENT" } as any,
        });
        assert.strictEqual(resGap.severity, "CRITICAL");
      });

      it("Data Guard unconfigured or disabled must return OK", () => {
        const res1 = evaluateDataGuardLag({ dataGuard: { enabled: false, configured: false } as any });
        assert.strictEqual(res1.severity, "OK");
        assert.strictEqual(res1.triggered, false);

        const res2 = evaluateDataGuardLag({});
        assert.strictEqual(res2.severity, "OK");
      });
    });
  });

  // -------------------------------------------------------------------------
  // 2. AI Prompt Synthesizer & Fallback Stress Testing
  // -------------------------------------------------------------------------
  describe("2. AI Diagnostic Prompt Builder & Fallback Stress Testing", () => {
    it("should build prompt successfully with completely empty telemetry {}", () => {
      const emptyTelemetry: OracleTelemetryInput = {};
      const report = evaluateOracleRules(emptyTelemetry);
      const prompt = buildOracleGeminiPrompt(emptyTelemetry, report);

      assert.ok(typeof prompt === "string");
      assert.ok(prompt.length > 200);
      assert.ok(prompt.includes("Oracle Certified Master DBA"));
      assert.ok(prompt.includes("Standalone (Non-CDB)"));
      assert.ok(prompt.includes("None (Non-CDB)"));
      assert.ok(prompt.includes("ASM Not Configured"));
    });

    it("should build prompt with empty/sparse sub-fields in CDB topology", () => {
      const sparseCdbTelemetry: OracleTelemetryInput = {
        isCdb: true,
        instanceName: "ORCLCDB_EMPTY",
        pdbs: [],
        asmDiskgroups: [],
        topWaitEvents: [],
        sga: {},
        pga: {},
        redoLogs: {},
        dataGuard: { configured: false },
      };
      const report = evaluateOracleRules(sparseCdbTelemetry);
      const prompt = buildOracleGeminiPrompt(sparseCdbTelemetry, report, {
        incidentContext: "Stress test empty CDB",
        type: "incident",
      });

      assert.ok(prompt.includes("Multitenant Container Database (CDB/PDB)"));
      assert.ok(prompt.includes("None (Non-CDB)"));
      assert.ok(prompt.includes("Buffer Cache Hit Ratio: 100%"));
      assert.ok(prompt.includes("Stress test empty CDB"));
    });

    it("should build prompt with slow_query type and query context", () => {
      const telemetry: OracleTelemetryInput = {
        isCdb: false,
        instanceName: "ORCL_PROD",
      };
      const report = evaluateOracleRules(telemetry);
      const prompt = buildOracleGeminiPrompt(telemetry, report, {
        query: "SELECT /*+ FULL(e) */ * FROM employees e WHERE salary > 100000;",
        type: "slow_query",
      });

      assert.ok(prompt.includes("TARGET SLOW QUERY TO ANALYZE"));
      assert.ok(prompt.includes("SELECT /*+ FULL(e) */ * FROM employees"));
    });

    it("should generate deterministic offline fallback diagnostic report across clean and all-critical states", () => {
      // 1. Clean report
      const cleanReport = evaluateOracleRules({
        sga: { bufferCacheHitRatio: 99.0 },
        redoLogs: { switchesLastHour: 3 } as any,
        isCdb: true,
        pdbs: [{ pdbName: "PDB1", cpuSlicePct: 20.0 } as any],
        asmEnabled: true,
        asmDiskgroups: [{ name: "+DATA", freePct: 40.0, usableFileMb: 500000 } as any],
        dataGuard: { enabled: true, configured: true, applyLagSeconds: 0, gapStatus: "NONE" } as any,
      });

      const cleanFallback = buildDeterministicOracleFallback({}, cleanReport);
      assert.strictEqual(cleanFallback.overallHealth, "HEALTHY");
      assert.ok(cleanFallback.analysis.includes("Zero active heuristic rule violations"));
      assert.ok(cleanFallback.recommendations.length >= 2);
      assert.ok(cleanFallback.suggestedSql.includes("v$instance"));

      // 2. All-Critical report
      const critReport = evaluateOracleRules({
        sga: { bufferCacheHitRatio: 65.0 },
        redoLogs: { switchesLastHour: 25 } as any,
        isCdb: true,
        pdbs: [{ pdbName: "ROGUE_PDB", cpuSlicePct: 92.0, avgWaitingSessions: 5 } as any],
        asmEnabled: true,
        asmDiskgroups: [{ name: "+FRA", freePct: 2.0, usableFileMb: 0 } as any],
        dataGuard: { enabled: true, configured: true, applyLagSeconds: 600, gapStatus: "GAP" } as any,
      });

      assert.strictEqual(critReport.overallHealth, "CRITICAL");
      assert.strictEqual(critReport.criticalCount, 5);
      const critFallback = buildDeterministicOracleFallback({}, critReport);
      assert.strictEqual(critFallback.overallHealth, "CRITICAL");
      assert.strictEqual(critFallback.ruleResults.length, 5);
      assert.ok(critFallback.analysis.includes("ORCL-01 CRITICAL"));
      assert.ok(critFallback.analysis.includes("ORCL-02 CRITICAL"));
      assert.ok(critFallback.analysis.includes("ORCL-03 CRITICAL"));
      assert.ok(critFallback.analysis.includes("ORCL-04 CRITICAL"));
      assert.ok(critFallback.analysis.includes("ORCL-05 CRITICAL"));
      assert.ok(critFallback.recommendations.length > 0);
      assert.ok(critFallback.suggestedSql.includes("ALTER SYSTEM"));
    });
  });

  // -------------------------------------------------------------------------
  // 3. Frontend Data Contracts & Telemetry Resilience Verification
  // -------------------------------------------------------------------------
  describe("3. Frontend Data Contracts & Telemetry Resilience", () => {
    it("MOCK_ORACLE_CDB_METRICS should adhere strictly to OracleEngineMetrics type and provide all expected UI properties", () => {
      const cdb = MOCK_ORACLE_CDB_METRICS;
      assert.strictEqual(cdb.isCdb, true);
      assert.ok(cdb.sga.totalSgaMb > 0);
      assert.ok(cdb.sga.bufferCacheHitRatio > 0);
      assert.ok(cdb.pga.pgaTargetMb > 0);
      assert.ok(cdb.redoLogs.last24HoursHistory.length === 24);
      assert.ok(cdb.asmDiskgroups.length > 0);
      assert.ok(cdb.pdbs && cdb.pdbs.length > 0);
      assert.ok(cdb.backgroundProcesses.pmon === "RUNNING");
      assert.ok(cdb.topWaitEvents.length > 0);
    });

    it("MOCK_ORACLE_STANDALONE_METRICS should adhere strictly to OracleEngineMetrics for standalone instances", () => {
      const standalone = MOCK_ORACLE_STANDALONE_METRICS;
      assert.strictEqual(standalone.isCdb, false);
      assert.strictEqual(standalone.pdbs?.length, 0);
      assert.ok(standalone.sga.bufferCacheHitRatio > 0);
      assert.ok(standalone.dataGuard.enabled);
      assert.ok(standalone.dataGuard.applyLagSeconds > 60);
    });

    it("INITIAL_DATABASES should contain Oracle instances properly attached with engineSpecific.oracle", () => {
      const oracleDbs = INITIAL_DATABASES.filter((d) => d.engine === "Oracle");
      assert.ok(oracleDbs.length >= 2, "Expected at least 2 Oracle instances (CDB and Standalone)");

      for (const db of oracleDbs) {
        assert.ok(db.engineSpecific?.oracle, `Oracle instance ${db.id} must have engineSpecific.oracle defined`);
        const metrics: OracleEngineMetrics = db.engineSpecific.oracle;
        assert.ok(metrics.instanceName);
        assert.ok(metrics.sga);
        assert.ok(metrics.pga);
        assert.ok(metrics.redoLogs);
        assert.ok(metrics.redoLogs.last24HoursHistory);
      }
    });

    it("should verify rule evaluation on live mock instances accurately reflects intended health states", () => {
      // CDB Instance evaluation:
      // MOCK_ORACLE_CDB has switchesLastHour = 9 (> 6) -> ORCL-02 WARNING
      // PDB SALES_PDB has cpuSlicePct = 62.5% (<= 70%) -> ORCL-03 OK
      const cdbReport = evaluateOracleRules(MOCK_ORACLE_CDB_METRICS);
      assert.strictEqual(cdbReport.overallHealth, "WARNING");
      assert.strictEqual(cdbReport.warningCount, 1);
      assert.strictEqual(cdbReport.criticalCount, 0);
      const orcl02 = cdbReport.findings.find((f) => f.ruleId === "ORCL-02");
      assert.ok(orcl02 && orcl02.severity === "WARNING");

      // Standalone Instance evaluation:
      // MOCK_ORACLE_STANDALONE has bufferCacheHitRatio = 86.4% (< 90%) -> ORCL-01 WARNING
      // +RECO freePct = 11.0% (< 15%) -> ORCL-04 WARNING
      // Data Guard applyLagSeconds = 142.5s (> 60s) -> ORCL-05 WARNING
      const stbyReport = evaluateOracleRules(MOCK_ORACLE_STANDALONE_METRICS);
      assert.strictEqual(stbyReport.overallHealth, "WARNING");
      assert.strictEqual(stbyReport.warningCount, 3);
      assert.strictEqual(stbyReport.criticalCount, 0);
    });
  });
});
