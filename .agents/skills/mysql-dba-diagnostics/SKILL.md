---
name: mysql-dba-diagnostics
description: MySQL & MariaDB InnoDB performance diagnostics, slow query index analysis, lock contention, and replication lag troubleshooting.
---

# MySQL / InnoDB DBA Diagnostics & Runbook Skill

Use this skill when analyzing MySQL/MariaDB database telemetry, diagnosing InnoDB lock contention, tuning buffer pools, investigating replication lag, or addressing slow queries in DataPulse Sentinel.

## 1. InnoDB Buffer Pool Hit Ratio & Sizing

### Calculating Buffer Pool Hit Ratio (Target: > 99%)
```sql
SELECT 
  ROUND((1 - (innodb_buffer_pool_reads / innodb_buffer_pool_read_requests)) * 100, 2) AS buffer_pool_hit_ratio
FROM (
  SELECT 
    MAX(IF(variable_name = 'Innodb_buffer_pool_reads', variable_value, 0)) AS innodb_buffer_pool_reads,
    MAX(IF(variable_name = 'Innodb_buffer_pool_read_requests', variable_value, 0)) AS innodb_buffer_pool_read_requests
  FROM performance_schema.global_status
  WHERE variable_name IN ('Innodb_buffer_pool_reads', 'Innodb_buffer_pool_read_requests')
) AS stats;
```

### Buffer Pool Sizing Recommendation
- In dedicated database instances, configure `innodb_buffer_pool_size` to **60% - 75%** of available physical server RAM.
- When `innodb_buffer_pool_size` > 1GB, set `innodb_buffer_pool_instances = 8` to reduce mutex contention.

---

## 2. Slow Queries & Missing Indexes (sys Schema)

### Queries Performing Full Table Scans
```sql
SELECT 
  query, 
  exec_count, 
  total_latency, 
  no_index_used_count, 
  no_good_index_used_count, 
  rows_examined_avg, 
  rows_sent_avg
FROM sys.statements_with_full_table_scans
ORDER BY total_latency DESC
LIMIT 10;
```

### Top Queries by Total Execution Time
```sql
SELECT 
  query, 
  exec_count, 
  ROUND(total_latency / 1000000000, 2) AS total_latency_sec,
  ROUND(avg_latency / 1000000, 2) AS avg_latency_ms,
  lock_latency, 
  rows_sent, 
  rows_examined
FROM sys.statement_analysis
ORDER BY total_latency DESC
LIMIT 10;
```

---

## 3. Active Transaction & Lock Contention

### Inspecting Blocked Transactions
```sql
SELECT 
  r.trx_id AS requesting_trx_id,
  r.trx_mysql_thread_id AS requesting_thread,
  r.trx_query AS requesting_query,
  b.trx_id AS blocking_trx_id,
  b.trx_mysql_thread_id AS blocking_thread,
  b.trx_query AS blocking_query,
  TIMESTAMPDIFF(SECOND, r.trx_wait_started, NOW()) AS wait_time_seconds
FROM performance_schema.data_lock_waits w
JOIN information_schema.innodb_trx r ON r.trx_id = w.requesting_engine_transaction_id
JOIN information_schema.innodb_trx b ON b.trx_id = w.blocking_engine_transaction_id;
```

### Terminating a Blocking Thread
`KILL CONNECTION <blocking_thread_id>;`

---

## 4. Connection Pool & Thread Pool Contention

```sql
SELECT 
  variable_name, 
  variable_value 
FROM performance_schema.global_status 
WHERE variable_name IN (
  'Threads_connected', 
  'Threads_running', 
  'Max_used_connections', 
  'Connection_errors_max_connections', 
  'Aborted_connects'
);
```
- High `Threads_running` (> 30-50) causes CPU thrashing and context switching.

---

## 5. Replication Lag Diagnostics

```sql
SHOW REPLICA STATUS;
```
Key health fields:
- `Replica_IO_Running: Yes` & `Replica_SQL_Running: Yes`
- `Seconds_Behind_Source`: Target `< 5s`. If elevated, check single-threaded SQL apply bottlenecks and enable multi-threaded replication:
  ```sql
  SET GLOBAL replica_parallel_workers = 4;
  SET GLOBAL replica_parallel_type = 'LOGICAL_CLOCK';
  ```
