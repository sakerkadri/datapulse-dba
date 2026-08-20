import { WindowsWqlResult } from "../../types/host";
import {
  FIXTURE_WINDOWS_HEALTHY,
  FIXTURE_WINDOWS_HIGH_CPU,
  FIXTURE_WINDOWS_PAGEFILE_PRESSURE,
  FIXTURE_WINDOWS_DISK_CRITICAL,
  FIXTURE_WINDOWS_IO_BOTTLENECK,
  FIXTURE_WINDOWS_WMI_FALLBACK,
} from "./fixtures/windowsHostFixtures";

export type WindowsMockScenario =
  | "HEALTHY_WINDOWS"
  | "HIGH_CPU_SATURATION"
  | "MEMORY_PAGEFILE_PRESSURE"
  | "DISK_SPACE_CRITICAL"
  | "STORAGE_IOPS_BOTTLENECK"
  | "WMI_CORRUPTED_FALLBACK"
  | "WINRM_CONNECTION_TIMEOUT";

export class MockWindowsHostDriver {
  private scenario: WindowsMockScenario;

  constructor(scenario: WindowsMockScenario = "HEALTHY_WINDOWS") {
    this.scenario = scenario;
  }

  public setScenario(scenario: WindowsMockScenario) {
    this.scenario = scenario;
  }

  public getScenario(): WindowsMockScenario {
    return this.scenario;
  }

  public async executeWqlQueries(hostId: string): Promise<WindowsWqlResult> {
    if (this.scenario === "WINRM_CONNECTION_TIMEOUT") {
      throw new Error(`[WinRM] Connection to ${hostId}:5985 timed out after 5000ms (ETIMEDOUT).`);
    }

    switch (this.scenario) {
      case "HIGH_CPU_SATURATION":
        return JSON.parse(JSON.stringify(FIXTURE_WINDOWS_HIGH_CPU));
      case "MEMORY_PAGEFILE_PRESSURE":
        return JSON.parse(JSON.stringify(FIXTURE_WINDOWS_PAGEFILE_PRESSURE));
      case "DISK_SPACE_CRITICAL":
        return JSON.parse(JSON.stringify(FIXTURE_WINDOWS_DISK_CRITICAL));
      case "STORAGE_IOPS_BOTTLENECK":
        return JSON.parse(JSON.stringify(FIXTURE_WINDOWS_IO_BOTTLENECK));
      case "WMI_CORRUPTED_FALLBACK":
        return JSON.parse(JSON.stringify(FIXTURE_WINDOWS_WMI_FALLBACK));
      case "HEALTHY_WINDOWS":
      default:
        return JSON.parse(JSON.stringify(FIXTURE_WINDOWS_HEALTHY));
    }
  }
}
