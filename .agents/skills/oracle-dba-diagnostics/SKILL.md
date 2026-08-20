---
name: oracle-dba-diagnostics
description: Comprehensive Oracle Database DBA diagnostics, CDB/PDB multitenant monitoring, SGA/PGA memory sizing, AWR/ASH wait events, tablespace metrics, and lock contention remediation.
---

# Oracle DBA Diagnostics & Performance Tuning Skill

Use this skill when analyzing Oracle Database performance incidents, investigating Multitenant (CDB/PDB) environments, diagnosing Top Wait Events, checking tablespace saturation, or generating Oracle-specific remediation in DataPulse Sentinel.

## 1. Multitenant Architecture (CDB & PDB) Diagnostics

### PDB Status, Open Mode & Restricted State
```sql
SELECT 
  con_id,
  name AS pdb_name,
  open_mode,
  restricted,
  total_size / (1024*1024*1024) AS size_gb,
  recovery_status
FROM v$pdbs
ORDER BY con_id;
```

### Per-PDB Resource & Session Allocation
```sql
SELECT 
  s.con_id,
  p.name AS pdb_name,
  COUNT(s.sid) AS active_sessions,
  ROUND(SUM(s.value) / 100, 2) AS cpu_seconds_used
FROM v$session s
JOIN v$pdbs p ON s.con_id = p.con_id
LEFT JOIN v$sesstat ss ON s.sid = ss.sid AND ss.statistic# = (SELECT statistic# FROM v$statname WHERE name = 'CPU used by this session')
WHERE s.status = 'ACTIVE' AND s.type != 'BACKGROUND'
GROUP BY s.con_id, p.name
ORDER BY active_sessions DESC;
```

---

## 2. SGA & PGA Memory Diagnostics

### Buffer Cache Hit Ratio & Shared Pool Free Memory
```sql
-- Buffer Cache Hit Ratio
SELECT 
  ROUND((1 - (phy.value / (cur.value + con.value))) * 100, 2) AS buffer_cache_hit_ratio
FROM v$sysstat phy, v$sysstat cur, v$sysstat con
WHERE phy.name = 'physical reads'
  AND cur.name = 'db block gets'
  AND con.name = 'consistent gets';

-- SGA Dynamic Components Breakdown
SELECT 
  component,
  ROUND(current_size / (1024*1024), 2) AS current_mb,
  ROUND(min_size / (1024*1024), 2) AS min_mb,
  ROUND(max_size / (1024*1024), 2) AS max_mb,
  last_oper_type,
  last_oper_time
FROM v$sga_dynamic_components
WHERE current_size > 0;
```

---

## 3. Top Wait Events & ASH (Active Session History)

### Current Top Wait Events in Real-Time
```sql
SELECT 
  event,
  wait_class,
  total_waits,
  ROUND(time_waited_micro / 1000000, 2) AS time_waited_sec,
  ROUND(average_wait / 100, 2) AS avg_wait_ms
FROM v$system_event
WHERE wait_class NOT IN ('Idle')
ORDER BY time_waited_micro DESC
FETCH FIRST 10 ROWS ONLY;
```

### Interpreting Top Oracle Wait Classes
- **`db file sequential read`**: Single-block I/O wait, usually caused by index range scans or missing composite index leading to excessive random reads.
- **`db file scattered read`**: Multi-block I/O wait, indicative of full table scans (FTS) or fast full index scans.
- **`log file sync`**: Commit wait while LGWR flushes redo buffers to disk. Check redo log disk latency or commit frequency inside tight loops.
- **`enq: TX - row lock contention`**: Application lock contention; sessions trying to update/delete the same row.
- **`buffer busy waits`**: Multiple sessions attempting to access the same buffer in cache concurrently.

---

## 4. Tablespace Utilization & Autoextend Headroom

```sql
SELECT 
  df.tablespace_name,
  ROUND(df.total_space_mb, 2) AS total_mb,
  ROUND(df.total_space_mb - NVL(fs.free_space_mb, 0), 2) AS used_mb,
  ROUND(NVL(fs.free_space_mb, 0), 2) AS free_mb,
  ROUND(((df.total_space_mb - NVL(fs.free_space_mb, 0)) / df.total_space_mb) * 100, 2) AS used_pct,
  df.autoextensible
FROM (
  SELECT 
    tablespace_name,
    SUM(bytes) / (1024*1024) AS total_space_mb,
    MAX(autoextensible) AS autoextensible
  FROM dba_data_files
  GROUP BY tablespace_name
) df
LEFT JOIN (
  SELECT 
    tablespace_name,
    SUM(bytes) / (1024*1024) AS free_space_mb
  FROM dba_free_space
  GROUP BY tablespace_name
) fs ON df.tablespace_name = fs.tablespace_name
ORDER BY used_pct DESC;
```

---

## 5. Blocking Sessions & Lock Tree Inspector

```sql
SELECT 
  blocking_session AS blocker_sid,
  sid AS blocked_sid,
  serial#,
  username,
  sql_id,
  seconds_in_wait,
  event
FROM v$session
WHERE blocking_session IS NOT NULL;
```

### Session Termination:
```sql
ALTER SYSTEM KILL SESSION '<sid>,<serial#>' IMMEDIATE;
```
