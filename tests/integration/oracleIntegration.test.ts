import { describe, it } from "node:test";
import assert from "node:assert";
import { OracleCollector } from "../../src/collectors/oracle/oracleCollector";
import { MockOracleDriver } from "../../src/collectors/mock/mockOracleDriver";
import { evaluateOracleRules, buildDeterministicOracleFallback } from "../../src/diagnostics/rules/oracleRules";

describe("Oracle End-to-End Integration Tests", () => {
  it("Scenario 1: End-to-end healthy CDB collection & rule evaluation", async () => {
    const driver = new MockOracleDriver("HEALTHY_CDB");
    const collector = new OracleCollector({ host: "ora-primary.corp", isMock: true }, driver);

    const telemetry = await collector.collect();
    const report = evaluateOracleRules(telemetry);

    assert.strictEqual(telemetry.status, "ONLINE");
    assert.strictEqual(report.overallHealth, "HEALTHY");
    assert.strictEqual(report.criticalCount, 0);
    assert.strictEqual(report.warningCount, 0);
  });

  it("Scenario 2: PDB Starvation scenario triggers ORCL-03", async () => {
    const driver = new MockOracleDriver("PDB_STARVATION");
    const collector = new OracleCollector({ host: "ora-primary.corp", isMock: true }, driver);

    const telemetry = await collector.collect();
    const report = evaluateOracleRules(telemetry);

    assert.strictEqual(report.overallHealth, "CRITICAL");
    const r3 = report.findings.find((f) => f.ruleId === "ORCL-03");
    assert.ok(r3);
    assert.strictEqual(r3.severity, "CRITICAL");
    assert.strictEqual(r3.targetResource, "PDB: PDB_FINANCE");

    const fallback = buildDeterministicOracleFallback(telemetry, report);
    assert.ok(fallback.analysis.includes("PDB_FINANCE"));
    assert.ok(fallback.suggestedSql.includes("DBMS_RESOURCE_MANAGER"));
  });

  it("Scenario 3: High Log Switch scenario triggers ORCL-02 and ORCL-01", async () => {
    const driver = new MockOracleDriver("HIGH_LOG_SWITCH");
    const collector = new OracleCollector({ host: "ora-primary.corp", isMock: true }, driver);

    const telemetry = await collector.collect();
    const report = evaluateOracleRules(telemetry);

    assert.strictEqual(report.overallHealth, "CRITICAL");
    const r2 = report.findings.find((f) => f.ruleId === "ORCL-02");
    const r1 = report.findings.find((f) => f.ruleId === "ORCL-01");
    assert.ok(r2);
    assert.strictEqual(r2.severity, "CRITICAL");
    assert.ok(r1);
    assert.strictEqual(r1.severity, "WARNING");
  });

  it("Scenario 4: Data Guard Lag scenario triggers ORCL-05", async () => {
    const driver = new MockOracleDriver("DATA_GUARD_LAG");
    const collector = new OracleCollector({ host: "ora-primary.corp", isMock: true }, driver);

    const telemetry = await collector.collect();
    const report = evaluateOracleRules(telemetry);

    assert.strictEqual(report.overallHealth, "CRITICAL");
    const r5 = report.findings.find((f) => f.ruleId === "ORCL-05");
    assert.ok(r5);
    assert.strictEqual(r5.severity, "CRITICAL");
    assert.ok(r5.summary.includes("gap"));
  });

  it("Scenario 5: Tablespace / ASM Full scenario triggers ORCL-04", async () => {
    const driver = new MockOracleDriver("TABLESPACE_FULL");
    const collector = new OracleCollector({ host: "ora-primary.corp", isMock: true }, driver);

    const telemetry = await collector.collect();
    const report = evaluateOracleRules(telemetry);

    assert.strictEqual(report.overallHealth, "CRITICAL");
    const r4 = report.findings.find((f) => f.ruleId === "ORCL-04");
    assert.ok(r4);
    assert.strictEqual(r4.severity, "CRITICAL");
    assert.strictEqual(r4.metricValue, 4.2);
  });

  it("Scenario 6: Dynamic Scenario Switching on Live Collector", async () => {
    const driver = new MockOracleDriver("HEALTHY_CDB");
    const collector = new OracleCollector({ host: "ora-primary.corp", isMock: true }, driver);

    // Turn 1: Healthy
    let telemetry = await collector.collect();
    let report = evaluateOracleRules(telemetry);
    assert.strictEqual(report.overallHealth, "HEALTHY");

    // Turn 2: Mutate to DATA_GUARD_LAG
    driver.setScenario("DATA_GUARD_LAG");
    telemetry = await collector.collect();
    report = evaluateOracleRules(telemetry);
    assert.strictEqual(report.overallHealth, "CRITICAL");
    assert.ok(report.findings.some((f) => f.ruleId === "ORCL-05" && f.triggered));

    // Turn 3: Mutate to STANDALONE_NON_CDB
    driver.setScenario("STANDALONE_NON_CDB");
    telemetry = await collector.collect();
    report = evaluateOracleRules(telemetry);
    assert.strictEqual(telemetry.isCdb, false);
    assert.strictEqual(report.overallHealth, "HEALTHY");
  });
});
