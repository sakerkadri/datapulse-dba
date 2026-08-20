import {
  RAW_LINUX_HEALTHY_TICK1,
  RAW_LINUX_HEALTHY_TICK2,
  RAW_LINUX_HIGH_CPU_TICK2,
  RAW_LINUX_IOWAIT_TICK2,
  RAW_LINUX_SWAP_PRESSURE,
  RAW_LINUX_DISK_CRITICAL,
  RAW_LINUX_LEGACY_RHEL6,
} from "./fixtures/linuxHostFixtures";

export type LinuxMockScenario =
  | "HEALTHY_LINUX"
  | "HIGH_CPU_SATURATION"
  | "HIGH_IOWAIT_BOTTLENECK"
  | "MEMORY_SWAP_PRESSURE"
  | "DISK_SPACE_CRITICAL"
  | "LEGACY_KERNEL_RHEL6"
  | "COUNTER_WRAP_REBOOT"
  | "AUTH_FAILURE"
  | "CONNECTION_TIMEOUT";

export class MockLinuxHostDriver {
  private scenario: LinuxMockScenario;
  private tickMap: Map<string, number> = new Map();

  constructor(scenario: LinuxMockScenario = "HEALTHY_LINUX") {
    this.scenario = scenario;
  }

  public setScenario(scenario: LinuxMockScenario) {
    this.scenario = scenario;
  }

  public getScenario(): LinuxMockScenario {
    return this.scenario;
  }

  public resetTicks(hostId?: string) {
    if (hostId) {
      this.tickMap.delete(hostId);
    } else {
      this.tickMap.clear();
    }
  }

  public async executeBatchCommand(hostId: string): Promise<string> {
    if (this.scenario === "AUTH_FAILURE") {
      throw new Error(`[SSH] Authentication failed for user 'root' on ${hostId}:22 (Permission denied, publickey).`);
    }

    if (this.scenario === "CONNECTION_TIMEOUT") {
      throw new Error(`[SSH] Connection to ${hostId}:22 timed out after 5000ms (ETIMEDOUT).`);
    }

    const currentTick = (this.tickMap.get(hostId) || 0) + 1;
    this.tickMap.set(hostId, currentTick);

    if (this.scenario === "COUNTER_WRAP_REBOOT") {
      // Simulate counter wrap or reboot after tick 2
      if (currentTick % 2 === 1) {
        return RAW_LINUX_HEALTHY_TICK2;
      }
      return RAW_LINUX_HEALTHY_TICK1;
    }

    if (currentTick === 1) {
      return RAW_LINUX_HEALTHY_TICK1;
    }

    switch (this.scenario) {
      case "HIGH_CPU_SATURATION":
        return RAW_LINUX_HIGH_CPU_TICK2;
      case "HIGH_IOWAIT_BOTTLENECK":
        return RAW_LINUX_IOWAIT_TICK2;
      case "MEMORY_SWAP_PRESSURE":
        return RAW_LINUX_SWAP_PRESSURE;
      case "DISK_SPACE_CRITICAL":
        return RAW_LINUX_DISK_CRITICAL;
      case "LEGACY_KERNEL_RHEL6":
        return RAW_LINUX_LEGACY_RHEL6;
      case "HEALTHY_LINUX":
      default:
        return RAW_LINUX_HEALTHY_TICK2;
    }
  }
}
