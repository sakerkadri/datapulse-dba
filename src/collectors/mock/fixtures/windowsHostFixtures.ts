import { WindowsWqlResult } from "../../../types/host";

export const FIXTURE_WINDOWS_HEALTHY: WindowsWqlResult = {
  cpu: {
    PercentProcessorTime: 24,
    PercentUserTime: 18,
    PercentPrivilegedTime: 6,
    NumberOfCores: 8,
  },
  os: {
    TotalVisibleMemorySize: 67108864, // 64 GB in KB
    FreePhysicalMemory: 41943040,      // 40 GB Free in KB
    TotalVirtualMemorySize: 134217728, // 128 GB in KB
    FreeVirtualMemory: 117440512,      // 112 GB Free in KB
    NumberOfProcesses: 142,
    LastBootUpTime: "20260801100000.000000+000",
    Caption: "Microsoft Windows Server 2022 Datacenter",
    Version: "10.0.20348",
  },
  disks: [
    {
      DeviceID: "C:",
      VolumeName: "OS_Disk",
      Size: 214748364800,      // 200 GB
      FreeSpace: 128849018880, // 120 GB free (40% used)
      FileSystem: "NTFS",
      DriveType: 3,
    },
    {
      DeviceID: "D:",
      VolumeName: "SQL_Data",
      Size: 1073741824000,     // 1 TB
      FreeSpace: 536870912000, // 500 GB free (50% used)
      FileSystem: "NTFS",
      DriveType: 3,
    },
    {
      DeviceID: "E:",
      VolumeName: "CD_ROM",
      Size: 0,
      FreeSpace: 0,
      FileSystem: "CDFS",
      DriveType: 5,            // Should be filtered out
    },
  ],
  diskPerf: {
    DiskTransfersPerSec: 350,
    DiskReadsPerSec: 220,
    DiskWritesPerSec: 130,
    PercentDiskTime: 18,
    CurrentDiskQueueLength: 0.2,
  },
};

export const FIXTURE_WINDOWS_HIGH_CPU: WindowsWqlResult = {
  cpu: {
    PercentProcessorTime: 96,
    PercentUserTime: 82,
    PercentPrivilegedTime: 14,
    NumberOfCores: 16,
  },
  os: {
    TotalVisibleMemorySize: 67108864,
    FreePhysicalMemory: 25165824,
    TotalVirtualMemorySize: 134217728,
    FreeVirtualMemory: 94371840,
    NumberOfProcesses: 210,
    LastBootUpTime: "20260801100000.000000+000",
  },
  disks: [
    { DeviceID: "C:", Size: 214748364800, FreeSpace: 107374182400, DriveType: 3, FileSystem: "NTFS" },
  ],
  diskPerf: {
    DiskTransfersPerSec: 450,
    PercentDiskTime: 25,
  },
};

export const FIXTURE_WINDOWS_PAGEFILE_PRESSURE: WindowsWqlResult = {
  cpu: {
    PercentProcessorTime: 38,
    PercentUserTime: 26,
    PercentPrivilegedTime: 12,
  },
  os: {
    TotalVisibleMemorySize: 33554432, // 32 GB
    FreePhysicalMemory: 1048576,      // 1 GB Free (96.9% used)
    TotalVirtualMemorySize: 67108864, // 64 GB
    FreeVirtualMemory: 10485760,      // 10 GB Free (84.4% Swap used)
    LastBootUpTime: "20260801100000.000000+000",
  },
  disks: [
    { DeviceID: "C:", Size: 214748364800, FreeSpace: 107374182400, DriveType: 3, FileSystem: "NTFS" },
  ],
};

export const FIXTURE_WINDOWS_DISK_CRITICAL: WindowsWqlResult = {
  cpu: {
    PercentProcessorTime: 22,
  },
  os: {
    TotalVisibleMemorySize: 33554432,
    FreePhysicalMemory: 16777216,
    LastBootUpTime: "20260801100000.000000+000",
  },
  disks: [
    { DeviceID: "C:", VolumeName: "OS", Size: 107374182400, FreeSpace: 4294967296, DriveType: 3, FileSystem: "NTFS" }, // 96% used
    { DeviceID: "D:", VolumeName: "MSSQL_DATA", Size: 2147483648000, FreeSpace: 85899345920, DriveType: 3, FileSystem: "NTFS" }, // 96% used
  ],
};

export const FIXTURE_WINDOWS_IO_BOTTLENECK: WindowsWqlResult = {
  cpu: {
    PercentProcessorTime: 65,
    PercentUserTime: 40,
    PercentPrivilegedTime: 25,
  },
  os: {
    TotalVisibleMemorySize: 67108864,
    FreePhysicalMemory: 33554432,
    LastBootUpTime: "20260801100000.000000+000",
  },
  disks: [
    { DeviceID: "C:", Size: 536870912000, FreeSpace: 268435456000, DriveType: 3, FileSystem: "NTFS" },
  ],
  diskPerf: {
    DiskTransfersPerSec: 5400,
    CurrentDiskQueueLength: 16.5,
    PercentDiskTime: 98,
  },
};

export const FIXTURE_WINDOWS_WMI_FALLBACK: WindowsWqlResult = {
  cpuFallback: {
    LoadPercentage: 74,
    NumberOfCores: 8,
    NumberOfLogicalProcessors: 16,
  },
  os: {
    TotalVisibleMemorySize: 33554432,
    FreePhysicalMemory: 8388608,
  },
  disks: [
    { DeviceID: "C:", Size: 214748364800, FreeSpace: 107374182400, DriveType: 3, FileSystem: "NTFS" },
  ],
};
