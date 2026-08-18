---
name: postgres-dba-diagnostics
description: Comprehensive PostgreSQL DBA diagnostic procedures, live lock resolution, autovacuum optimization, buffer hit ratio tuning, and slow query remediation.
---

# PostgreSQL DBA Diagnostics & Performance Tuning Skill

Use this skill when analyzing PostgreSQL performance incidents, tuning queries, diagnosing autovacuum bottlenecks, or investigating lock contention in DataPulse Sentinel.

## 1. Live Query & Lock Contention Diagnostics

### Identifying Blocking Head Sessions
When query latency spikes or transactions hang:
```sql
SELECT
  blocked_locks.pid     AS blocked_pid,
  blocked_activity.usename  AS blocked_user,
  blocking_locks.pid    AS blocking_pid,
  blocking_activity.usename AS blocking_user,
  blocked_activity.query    AS blocked_statement,
  blocking_activity.query   AS blocking_statement,
  NOW() - blocked_activity.query_start AS blocked_duration
FROM  pg_catalog.pg_locks         blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks         blocking_locks 
    ON blocking_locks.locktype = blocked_locks.locktype
    AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
    AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
    AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
    AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
    AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
    AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
    AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
    AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
    AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
    AND blocking_locks.pid != blocked_locks.pid
JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;
```

### Terminating Rogue/Stuck Transactions
- Soft cancellation: `SELECT pg_cancel_backend(<pid>);`
- Hard termination: `SELECT pg_terminate_backend(<pid>);`

---

## 2. Autovacuum & Table Bloat Analysis

### Dead Tuples vs Live Tuples
```sql
SELECT
  schemaname,
  relname AS table_name,
  n_live_tup,
  n_dead_tup,
  ROUND(n_dead_tup::numeric / NULLIF(n_live_tup + n_dead_tup, 0) * 100, 2) AS dead_tuple_pct,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 10;
```

### Remediation for Aggressive Autovacuum
For high-write tables with bloat:
```sql
ALTER TABLE <table_name> SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_cost_limit = 1000,
  autovacuum_vacuum_cost_delay = 2
);
```

---

## 3. Buffer Cache Hit Ratio & Temp File Spills

### Cache Hit Ratio (SLA Target: > 99%)
```sql
SELECT 
  sum(heap_blks_read) as heap_read,
  sum(heap_blks_hit)  as heap_hit,
  ROUND(sum(heap_blks_hit)::numeric / NULLIF(sum(heap_blks_hit) + sum(heap_blks_read), 0) * 100, 2) AS buffer_hit_ratio
FROM pg_statio_user_tables;
```

### Temp File Disk Spills (Indicates insufficient `work_mem`)
```sql
SELECT 
  datname, 
  temp_files, 
  pg_size_pretty(temp_bytes) AS temp_file_size 
FROM pg_stat_database
ORDER BY temp_bytes DESC;
```

---

## 4. Index Diagnostics & Missing Indexes

### Identifying High Sequential Scans (Missing Index Candidates)
```sql
SELECT
  relname AS table_name,
  seq_scan,
  seq_tup_read,
  idx_scan,
  idx_tup_fetch,
  ROUND(seq_scan::numeric / NULLIF(seq_scan + idx_scan, 0) * 100, 2) AS seq_scan_pct
FROM pg_stat_user_tables
WHERE (seq_scan + idx_scan) > 500
ORDER BY seq_tup_read DESC
LIMIT 10;
```

### Unused Indexes (Wasting IO & Storage)
```sql
SELECT
  schemaname || '.' || relname AS table_name,
  indexrelname AS index_name,
  idx_scan,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE idx_scan = 0 AND indexrelname NOT LIKE '%_pkey'
ORDER BY pg_relation_size(indexrelid) DESC;
```

---

## 5. Replication & WAL Lag Analysis

```sql
SELECT
  client_addr,
  application_name,
  state,
  sync_state,
  sync_priority,
  pg_wal_lsn_diff(pg_current_wal_lsn(), sent_lsn) AS sent_lag_bytes,
  pg_wal_lsn_diff(sent_lsn, write_lsn) AS write_lag_bytes,
  pg_wal_lsn_diff(write_lsn, flush_lsn) AS flush_lag_bytes,
  pg_wal_lsn_diff(flush_lsn, replay_lsn) AS replay_lag_bytes
FROM pg_stat_replication;
```
