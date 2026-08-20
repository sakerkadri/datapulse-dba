import { describe, it } from "node:test";
import assert from "node:assert";
import {
  evaluateBufferCache,
  evaluateRedoLogSwitching,
  evaluatePdbCpuSkew,
  evaluateAsmDiskgroupSpace,
  evaluateDataGuardLag,
  evaluateOracleRules,
  buildOracleGeminiPrompt,
  buildDeterministicOracleFallback,
} from "../../src/diagnostics/rules/oracleRules";

describe("Oracle Rule Engine Heuristics (ORCL-01 to ORCL-05)", () => {
  // ORCL-01
  describe("ORCL-01: Buffer Cache Hit Ratio", () => {
    it("should evaluate OK when hit ratio >= 90%", () => {
      const res = evaluateBufferCache({ sga: { bufferCacheHitRatio: 99.4 } });
      assert.strictEqual(res.ruleId, "ORCL-01");
      assert.strictEqual(res.severity, "OK");
      assert.strictEqual(res.triggered, false);
    });

    it("should evaluate WARNING when 80% <= hit ratio < 90%", () => {
      const res = evaluateBufferCache({ sga: { bufferCacheHitRatio: 86.5 } });
      assert.strictEqual(res.severity, "WARNING");
      assert.strictEqual(res.triggered, true);
      assert.strictEqual(res.threshold, 90.0);
    });

    it("should evaluate CRITICAL when hit ratio < 80%", () => {
      const res = evaluateBufferCache({ sga: { bufferCacheHitRatio: 74.2 } });
      assert.strictEqual(res.severity, "CRITICAL");
      assert.strictEqual(res.triggered, true);
      assert.strictEqual(res.threshold, 80.0);
      assert.ok(res.remediationSql.some((sql) => sql.includes("db_cache_size")));
    });
  });

  // ORCL-02
  describe("ORCL-02: Redo Log Switches", () => {
    it("should evaluate OK when switches <= 6/hr", () => {
      const res = evaluateRedoLogSwitching({ redoLogs: { switchesLastHour: 4 } as any });
      assert.strictEqual(res.ruleId, "ORCL-02");
      assert.strictEqual(res.severity, "OK");
      assert.strictEqual(res.triggered, false);
    });

    it("should evaluate WARNING when 6 < switches <= 12/hr", () => {
      const res = evaluateRedoLogSwitching({ redoLogs: { switchesLastHour: 9 } as any });
      assert.strictEqual(res.severity, "WARNING");
      assert.strictEqual(res.triggered, true);
      assert.strictEqual(res.threshold, 6);
    });

    it("should evaluate CRITICAL when switches > 12/hr", () => {
      const res = evaluateRedoLogSwitching({ redoLogs: { switchesLastHour: 28 } as any });
      assert.strictEqual(res.severity, "CRITICAL");
      assert.strictEqual(res.triggered, true);
      assert.strictEqual(res.threshold, 12);
      assert.ok(res.remediationSql.some((sql) => sql.includes("ADD LOGFILE GROUP")));
    });
  });

  // ORCL-03
  describe("ORCL-03: PDB CPU Skew", () => {
    it("should evaluate OK for standalone non-CDB instance", () => {
      const res = evaluatePdbCpuSkew({ isCdb: false, pdbs: [] });
      assert.strictEqual(res.ruleId, "ORCL-03");
      assert.strictEqual(res.severity, "OK");
      assert.strictEqual(res.triggered, false);
    });

    it("should evaluate OK when all PDBs <= 70% CPU", () => {
      const res = evaluatePdbCpuSkew({
        isCdb: true,
        pdbs: [
          { conId: 3, pdbName: "PDB1", cpuSlicePct: 40.0 } as any,
          { conId: 4, pdbName: "PDB2", cpuSlicePct: 30.0 } as any,
        ],
      });
      assert.strictEqual(res.severity, "OK");
      assert.strictEqual(res.triggered, false);
    });

    it("should evaluate WARNING when single PDB > 70% without waiting sessions", () => {
      const res = evaluatePdbCpuSkew({
        isCdb: true,
        pdbs: [
          { conId: 3, pdbName: "PDB_SALES", cpuSlicePct: 75.0, avgWaitingSessions: 0 } as any,
          { conId: 4, pdbName: "PDB_FIN", cpuSlicePct: 15.0 } as any,
        ],
      });
      assert.strictEqual(res.severity, "WARNING");
      assert.strictEqual(res.triggered, true);
      assert.strictEqual(res.targetResource, "PDB: PDB_SALES");
    });

    it("should evaluate CRITICAL when single PDB > 85% or > 70% with waiting sessions", () => {
      const res = evaluatePdbCpuSkew({
        isCdb: true,
        pdbs: [
          { conId: 3, pdbName: "PDB_BATCH", cpuSlicePct: 88.5, avgWaitingSessions: 4.2 } as any,
        ],
      });
      assert.strictEqual(res.severity, "CRITICAL");
      assert.strictEqual(res.triggered, true);
      assert.ok(res.remediationSql.some((sql) => sql.includes("DBMS_RESOURCE_MANAGER")));
    });
  });

  // ORCL-04
  describe("ORCL-04: ASM Diskgroup Space", () => {
    it("should evaluate OK when ASM disabled or no diskgroups", () => {
      const res = evaluateAsmDiskgroupSpace({ asmEnabled: false, asmDiskgroups: [] });
      assert.strictEqual(res.ruleId, "ORCL-04");
      assert.strictEqual(res.severity, "OK");
      assert.strictEqual(res.triggered, false);
    });

    it("should evaluate OK when free space >= 15%", () => {
      const res = evaluateAsmDiskgroupSpace({
        asmEnabled: true,
        asmDiskgroups: [{ name: "DATA", freePct: 30.0, usableFileMb: 300000 } as any],
      });
      assert.strictEqual(res.severity, "OK");
      assert.strictEqual(res.triggered, false);
    });

    it("should evaluate WARNING when 5% <= free space < 15%", () => {
      const res = evaluateAsmDiskgroupSpace({
        asmEnabled: true,
        asmDiskgroups: [{ name: "RECO", freePct: 11.0, usableFileMb: 50000 } as any],
      });
      assert.strictEqual(res.severity, "WARNING");
      assert.strictEqual(res.triggered, true);
    });

    it("should evaluate CRITICAL when free space < 5% or usable space <= 0", () => {
      const res = evaluateAsmDiskgroupSpace({
        asmEnabled: true,
        asmDiskgroups: [{ name: "DATA", freePct: 4.2, usableFileMb: 0 } as any],
      });
      assert.strictEqual(res.severity, "CRITICAL");
      assert.strictEqual(res.triggered, true);
      assert.ok(res.remediationSql.some((sql) => sql.includes("ADD DISK")));
    });
  });

  // ORCL-05
  describe("ORCL-05: Data Guard Replication Lag", () => {
    it("should evaluate OK when Data Guard not configured", () => {
      const res = evaluateDataGuardLag({ dataGuard: { enabled: false, configured: false } as any });
      assert.strictEqual(res.ruleId, "ORCL-05");
      assert.strictEqual(res.severity, "OK");
      assert.strictEqual(res.triggered, false);
    });

    it("should evaluate OK when apply lag <= 60s", () => {
      const res = evaluateDataGuardLag({
        dataGuard: { enabled: true, configured: true, applyLagSeconds: 5, transportLagSeconds: 0, gapStatus: "NONE" } as any,
      });
      assert.strictEqual(res.severity, "OK");
      assert.strictEqual(res.triggered, false);
    });

    it("should evaluate WARNING when 60s < apply lag <= 300s", () => {
      const res = evaluateDataGuardLag({
        dataGuard: { enabled: true, configured: true, applyLagSeconds: 142, transportLagSeconds: 12, gapStatus: "NONE" } as any,
      });
      assert.strictEqual(res.severity, "WARNING");
      assert.strictEqual(res.triggered, true);
    });

    it("should evaluate CRITICAL when apply lag > 300s or gapStatus != NONE", () => {
      const res = evaluateDataGuardLag({
        dataGuard: { enabled: true, configured: true, applyLagSeconds: 345, transportLagSeconds: 40, gapStatus: "UNRESOLVED" } as any,
      });
      assert.strictEqual(res.severity, "CRITICAL");
      assert.strictEqual(res.triggered, true);
      assert.ok(res.remediationSql.some((sql) => sql.includes("RECOVER MANAGED STANDBY")));
    });
  });

  // Overall Report & Prompt Builder
  describe("Diagnostic Report & AI Prompt Synthesizer", () => {
    it("should evaluate overall report health status correctly", () => {
      const report = evaluateOracleRules({
        instanceName: "orclcdb1",
        isCdb: true,
        sga: { bufferCacheHitRatio: 99.4 },
        redoLogs: { switchesLastHour: 4 } as any,
        pdbs: [{ conId: 3, pdbName: "PDB1", cpuSlicePct: 30.0 } as any],
        asmEnabled: true,
        asmDiskgroups: [{ name: "DATA", freePct: 30.0 } as any],
        dataGuard: { enabled: true, configured: true, applyLagSeconds: 0 } as any,
      });

      assert.strictEqual(report.overallHealth, "HEALTHY");
      assert.strictEqual(report.criticalCount, 0);
      assert.strictEqual(report.warningCount, 0);
      assert.strictEqual(report.findings.length, 5);
    });

    it("should generate Oracle Master DBA prompt for Gemini", () => {
      const report = evaluateOracleRules({
        instanceName: "orclcdb1",
        isCdb: true,
        sga: { bufferCacheHitRatio: 78.0 },
        redoLogs: { switchesLastHour: 28 } as any,
      });

      const prompt = buildOracleGeminiPrompt(
        {
          sga: { bufferCacheHitRatio: 78.0, bufferCacheMb: 20480, sharedPoolMb: 8192 },
          redoLogs: { switchesLastHour: 28, avgSwitchesPerHour: 10 } as any,
        },
        report,
        { query: "SELECT * FROM sales_large WHERE id = 100;", type: "slow_query" }
      );

      assert.ok(prompt.includes("Oracle Certified Master DBA"));
      assert.ok(prompt.includes("ORCL-01"));
      assert.ok(prompt.includes("ORCL-02"));
      assert.ok(prompt.includes("sales_large"));
    });

    it("should generate deterministic offline fallback diagnostic report", () => {
      const report = evaluateOracleRules({
        instanceName: "orclcdb1",
        isCdb: true,
        sga: { bufferCacheHitRatio: 78.0 },
        redoLogs: { switchesLastHour: 28 } as any,
      });

      const fallback = buildDeterministicOracleFallback({ sga: { bufferCacheHitRatio: 78.0 } }, report);
      assert.strictEqual(fallback.overallHealth, "CRITICAL");
      assert.ok(fallback.analysis.includes("ORCL-01"));
      assert.ok(fallback.recommendations.length > 0);
      assert.ok(fallback.suggestedSql.includes("ALTER"));
    });
  });
});
