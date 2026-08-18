---
name: sqlserver-dba-diagnostics
description: Microsoft SQL Server DBA diagnostic procedures, wait statistics analysis, TempDB contention mitigation, memory pressure (PLE), and deadlock resolution.
---

# Microsoft SQL Server DBA Diagnostics & Runbook Skill

Use this skill when diagnosing SQL Server performance issues, analyzing DMV telemetry, tuning TempDB contention, investigating deadlocks, or interpreting wait statistics in DataPulse Sentinel.

## 1. Wait Statistics Analysis

### Identifying Server Bottlenecks
```sql
WITH Waits AS (
  SELECT 
    wait_type, 
    wait_time_ms / 1000.0 AS wait_time_s,
    100.0 * wait_time_ms / SUM(wait_time_ms) OVER() AS pct,
    ROW_NUMBER() OVER(ORDER BY wait_time_ms DESC) AS rn
  FROM sys.dm_os_wait_stats
  WHERE wait_type NOT IN (
    'CLR_SEMAPHORE', 'LAZYWRITER_SLEEP', 'RESOURCE_QUEUE', 'SLEEP_TASK',
    'SLEEP_SYSTEMTASK', 'SQLTRACE_BUFFER_FLUSH', 'WAITFOR', 'LOGMGR_QUEUE',
    'CHECKPOINT_QUEUE', 'REQUEST_FOR_DEADLOCK_SEARCH', 'XE_TIMER_EVENT',
    'BROKER_TO_FLUSH', 'BROKER_TASK_STOP', 'CLR_MANUAL_EVENT', 'CLR_AUTO_EVENT',
    'DISPATCHER_QUEUE_SEMAPHORE', 'FT_IFTS_SCHEDULER_IDLE_WAIT', 'XE_DISPATCHER_WAIT'
  )
)
SELECT wait_type, wait_time_s, pct
FROM Waits
WHERE rn <= 10;
```
- **`PAGEIOLATCH_*`**: Storage/Disk I/O latency or memory starvation.
- **`CXPACKET` / `CXCONSUMER`**: Parallel query imbalance (check Cost Threshold for Parallelism and MAXDOP).
- **`ASYNC_NETWORK_IO`**: Client application consuming rows slowly in batches.
- **`WRITELOG`**: Transaction log disk write bottlenecks.
- **`LCK_M_*`**: Lock contention / blocking transactions.

---

## 2. TempDB Contention Analysis (`PAGELATCH_UP` / `PAGELATCH_SH`)

### Allocation Page Contention (PFS / GAM / SGAM)
```sql
SELECT 
  session_id, 
  wait_type, 
  wait_duration_ms, 
  blocking_session_id, 
  resource_description,
  ResourceType = CASE 
    WHEN CAST(RIGHT(resource_description, LEN(resource_description) - CHARINDEX(':', resource_description, 3)) AS INT) - 1 % 8088 = 0 THEN 'PFS Page'
    WHEN CAST(RIGHT(resource_description, LEN(resource_description) - CHARINDEX(':', resource_description, 3)) AS INT) = 2 OR 
         CAST(RIGHT(resource_description, LEN(resource_description) - CHARINDEX(':', resource_description, 3)) AS INT) % 511232 = 0 THEN 'GAM Page'
    WHEN CAST(RIGHT(resource_description, LEN(resource_description) - CHARINDEX(':', resource_description, 3)) AS INT) = 3 OR 
         (CAST(RIGHT(resource_description, LEN(resource_description) - CHARINDEX(':', resource_description, 3)) AS INT) - 1) % 511232 = 0 THEN 'SGAM Page'
    ELSE 'Data Page'
  END
FROM sys.dm_os_waiting_tasks
WHERE wait_type LIKE 'PAGELATCH_%' AND resource_description LIKE '2:%';
```

### Remediation Best Practices
1. Multiple data files sized equally (`1 data file per CPU core up to 8`).
2. Ensure Trace Flag 1117 (grow all files equally) and 1118 (uniform extents) are enabled (default on SQL Server 2016+).

---

## 3. Memory & Page Life Expectancy (PLE)

```sql
SELECT 
  [object_name], 
  [counter_name], 
  [cntr_value] AS [Page Life Expectancy (Seconds)]
FROM sys.dm_os_performance_counters
WHERE [counter_name] = 'Page life expectancy'
  AND [object_name] LIKE '%Buffer Node%';
```
- Standard Rule of Thumb: Target $> 300\text{s}$ per 4GB of buffer pool RAM.
- A sudden drop indicates cache flushes caused by heavy table scans or index rebuilds.

---

## 4. Live Running Requests & Blocking Session Chains

```sql
SELECT 
  r.session_id,
  r.status,
  r.blocking_session_id,
  r.wait_type,
  r.wait_time / 1000.0 AS wait_time_sec,
  r.cpu_time,
  r.total_elapsed_time / 1000.0 AS elapsed_time_sec,
  r.reads,
  r.writes,
  r.logical_reads,
  t.text AS sql_statement,
  p.query_plan
FROM sys.dm_exec_requests r
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
CROSS APPLY sys.dm_exec_query_plan(r.plan_handle) p
WHERE r.session_id != @@SPID;
```

---

## 5. Missing Index DMV Recommendations

```sql
SELECT TOP 10
  ROUND(s.avg_total_user_cost * s.avg_user_impact * (s.user_seeks + s.user_scans), 0) AS total_cost_impact,
  d.statement AS table_name,
  d.equality_columns,
  d.inequality_columns,
  d.included_columns,
  s.user_seeks,
  s.user_scans,
  s.avg_user_impact AS avg_pct_improvement
FROM sys.dm_db_missing_index_groups g
JOIN sys.dm_db_missing_index_group_stats s ON s.group_handle = g.index_group_handle
JOIN sys.dm_db_missing_index_details d ON d.index_handle = g.index_handle
ORDER BY total_cost_impact DESC;
```
