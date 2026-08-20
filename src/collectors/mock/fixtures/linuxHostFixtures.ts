/**
 * Raw Linux /proc Fixtures for Unit and Integration Testing
 */

export const RAW_LINUX_HEALTHY_TICK1 = `===CPU===
cpu  200000 1000 100000 3700000 5000 100 200 0 0 0
===MEM===
MemTotal:       65536000 kB
MemFree:        16384000 kB
MemAvailable:   32768000 kB
Buffers:         2097152 kB
Cached:         18874368 kB
SwapTotal:      16777216 kB
SwapFree:       16777216 kB
===DISK===
Filesystem     1024-blocks      Used Available Capacity Mounted on
/dev/sda1        104857600  41943040  57579520      42% /
/dev/sdb1        524288000 209715200 288358400      42% /u01/app/oracle
/dev/sdc1       1048576000 314572800 681574400      32% /data/db
===LOAD===
1.25 1.10 0.95 2/450 18420
===IO===
   8       0 sda 25000 0 200000 500 15000 0 120000 300 0 150 150
   8      16 sdb 10000 0  80000 200  8000 0  64000 150 0  80  80
===UPTIME===
864000.50 720000.20
`;

export const RAW_LINUX_HEALTHY_TICK2 = `===CPU===
cpu  202000 1000 100500 3707500 5000 100 200 0 0 0
===MEM===
MemTotal:       65536000 kB
MemFree:        16384000 kB
MemAvailable:   32768000 kB
Buffers:         2097152 kB
Cached:         18874368 kB
SwapTotal:      16777216 kB
SwapFree:       16777216 kB
===DISK===
Filesystem     1024-blocks      Used Available Capacity Mounted on
/dev/sda1        104857600  41943040  57579520      42% /
/dev/sdb1        524288000 209715200 288358400      42% /u01/app/oracle
/dev/sdc1       1048576000 314572800 681574400      32% /data/db
===LOAD===
1.28 1.12 0.96 2/450 18455
===IO===
   8       0 sda 25250 0 202000 505 15150 0 121200 305 0 150 150
   8      16 sdb 10100 0  80800 202  8080 0  64640 152 0  80  80
===UPTIME===
864015.50 720012.20
`;

export const RAW_LINUX_HIGH_CPU_TICK2 = `===CPU===
cpu  275000 1000 121000 3704000 5000 100 200 0 0 0
===MEM===
MemTotal:       65536000 kB
MemFree:         8388608 kB
MemAvailable:   25165824 kB
Buffers:         1048576 kB
Cached:         16777216 kB
SwapTotal:      16777216 kB
SwapFree:       16777216 kB
===DISK===
Filesystem     1024-blocks      Used Available Capacity Mounted on
/dev/sda1        104857600  52428800  47185920      52% /
/dev/sdb1        524288000 262144000 235929600      52% /u01/app/oracle
===LOAD===
18.45 12.80 6.50 24/480 29402
===IO===
   8       0 sda 28000 0 224000 550 18000 0 144000 350 0 180 180
===UPTIME===
864015.50 720005.20
`;

export const RAW_LINUX_IOWAIT_TICK2 = `===CPU===
cpu  205000 1000 102000 3701000 45000 100 200 0 0 0
===MEM===
MemTotal:       65536000 kB
MemFree:        12582912 kB
MemAvailable:   29360128 kB
Buffers:         2097152 kB
Cached:         16777216 kB
SwapTotal:      16777216 kB
SwapFree:       16777216 kB
===DISK===
Filesystem     1024-blocks      Used Available Capacity Mounted on
/dev/sda1        104857600  41943040  57579520      42% /
/dev/sdb1        524288000 209715200 288358400      42% /u01/app/oracle
===LOAD===
8.20 5.40 3.10 8/450 19820
===IO===
   8       0 sda 45000 0 360000 900 35000 0 280000 700 0 940 940
   8      16 sdb 20000 0 160000 400 18000 0 144000 350 0 450 450
===UPTIME===
864015.50 720010.20
`;

export const RAW_LINUX_SWAP_PRESSURE = `===CPU===
cpu  205000 1000 102000 3703000 5000 100 200 0 0 0
===MEM===
MemTotal:       65536000 kB
MemFree:         1048576 kB
MemAvailable:    2097152 kB
Buffers:          524288 kB
Cached:          1048576 kB
SwapTotal:      16777216 kB
SwapFree:        8388608 kB
===DISK===
Filesystem     1024-blocks      Used Available Capacity Mounted on
/dev/sda1        104857600  41943040  57579520      42% /
===LOAD===
4.50 3.20 2.10 4/450 19200
===IO===
   8       0 sda 32000 0 256000 640 22000 0 176000 440 0 200 200
===UPTIME===
864015.50 720010.20
`;

export const RAW_LINUX_DISK_CRITICAL = `===CPU===
cpu  202000 1000 100500 3707500 5000 100 200 0 0 0
===MEM===
MemTotal:       65536000 kB
MemFree:        16384000 kB
MemAvailable:   32768000 kB
SwapTotal:      16777216 kB
SwapFree:       16777216 kB
===DISK===
Filesystem     1024-blocks      Used Available Capacity Mounted on
/dev/sda1        104857600  41943040  57579520      42% /
/dev/sdb1        524288000 498073600  26214400      95% /u01/app/oracle
/dev/sdc1       1048576000 1006632960  41943040      96% /data/db
===LOAD===
1.20 1.10 0.95 2/450 18400
===IO===
   8       0 sda 25000 0 200000 500 15000 0 120000 300 0 150 150
===UPTIME===
864015.50 720010.20
`;

export const RAW_LINUX_LEGACY_RHEL6 = `===CPU===
cpu  202000 1000 100500 3707500 5000 100 200 0 0 0
===MEM===
MemTotal:       33554432 kB
MemFree:         2097152 kB
Buffers:         1048576 kB
Cached:          5242880 kB
SwapTotal:       8388608 kB
SwapFree:        8388608 kB
===DISK===
Filesystem     1024-blocks      Used Available Capacity Mounted on
/dev/sda1        104857600  52428800  47185920      52% /
===LOAD===
0.80 0.60 0.45 1/320 12400
===IO===
   8       0 sda 12000 0 96000 240 8000 0 64000 160 0 80 80
===UPTIME===
432000.00 380000.00
`;
