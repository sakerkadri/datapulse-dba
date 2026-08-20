/**
 * Oracle Performance & Health Query Catalog
 * Path: src/collectors/oracle/oracleQueries.ts
 */

export const ORACLE_QUERIES = {
  // 1. Instance Topology & Health
  INSTANCE_INFO: `
    SELECT 
      d.name AS db_name,
      d.db_unique_name,
      d.database_role,
      d.cdb,
      d.open_mode,
      d.log_mode AS archivelog_mode,
      i.instance_name,
      i.host_name,
      i.version,
      TO_CHAR(i.startup_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS startup_time,
      ROUND((SYSDATE - i.startup_time) * 86400) AS uptime_seconds,
      i.status AS instance_status
    FROM v$database d, v$instance i
  `,

  // 2. SGA Allocation Breakdown
  SGA_INFO: `
    SELECT 
      name AS component_name,
      bytes,
      resizeable
    FROM v$sgainfo
    ORDER BY name
  `,

  // 3. PGA Memory Stats & Cache Hit Ratio
  PGA_STAT: `
    SELECT 
      name,
      value,
      unit
    FROM v$pgastat
    WHERE name IN (
      'aggregate PGA target parameter',
      'total PGA allocated',
      'total PGA inuse',
      'total freeable PGA memory',
      'maximum PGA allocated',
      'PGA memory freed back to OS',
      'cache hit percentage',
      'over allocation count'
    )
  `,

  // 4. Buffer Cache Hit Ratio
  BUFFER_CACHE_HIT_RATIO: `
    SELECT 
      ROUND(
        (1 - (
          NVL(SUM(CASE WHEN name = 'physical reads cache' THEN value ELSE 0 END), 0) /
          NULLIF(
            NVL(SUM(CASE WHEN name IN ('consistent gets from cache', 'db block gets from cache') THEN value ELSE 0 END), 0),
            0
          )
        )) * 100,
        2
      ) AS buffer_cache_hit_ratio,
      NVL(SUM(CASE WHEN name = 'physical reads cache' THEN value ELSE 0 END), 0) AS physical_reads_cache,
      NVL(SUM(CASE WHEN name = 'consistent gets from cache' THEN value ELSE 0 END), 0) AS consistent_gets_cache,
      NVL(SUM(CASE WHEN name = 'db block gets from cache' THEN value ELSE 0 END), 0) AS db_block_gets_cache
    FROM v$sysstat
    WHERE name IN ('physical reads cache', 'consistent gets from cache', 'db block gets from cache')
  `,

  BUFFER_CACHE_HIT_RATIO_FALLBACK: `
    SELECT 
      ROUND(
        (1 - (
          NVL(SUM(CASE WHEN name = 'physical reads' THEN value ELSE 0 END), 0) /
          NULLIF(
            NVL(SUM(CASE WHEN name IN ('consistent gets', 'db block gets') THEN value ELSE 0 END), 0),
            0
          )
        )) * 100,
        2
      ) AS buffer_cache_hit_ratio,
      NVL(SUM(CASE WHEN name = 'physical reads' THEN value ELSE 0 END), 0) AS physical_reads_cache,
      NVL(SUM(CASE WHEN name = 'consistent gets' THEN value ELSE 0 END), 0) AS consistent_gets_cache,
      NVL(SUM(CASE WHEN name = 'db block gets' THEN value ELSE 0 END), 0) AS db_block_gets_cache
    FROM v$sysstat
    WHERE name IN ('physical reads', 'consistent gets', 'db block gets')
  `,

  // 5. Redo Log Switches & History
  REDO_LOG_HISTORY: `
    SELECT 
      COUNT(CASE WHEN first_time >= SYSDATE - (1/24) THEN 1 END) AS switches_last_hour,
      COUNT(CASE WHEN first_time >= SYSDATE - (6/24) THEN 1 END) AS switches_last_6h,
      COUNT(CASE WHEN first_time >= SYSDATE - 1 THEN 1 END) AS switches_last_24h,
      ROUND(COUNT(CASE WHEN first_time >= SYSDATE - 1 THEN 1 END) / 24, 2) AS avg_switches_per_hour,
      TO_CHAR(MAX(first_time), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_switch_time
    FROM v$log_history
    WHERE first_time >= SYSDATE - 1
  `,

  REDO_HOURLY_HISTORY: `
    SELECT 
      TO_CHAR(first_time, 'HH24:00') AS time_bucket,
      COUNT(*) AS switch_count
    FROM v$log_history
    WHERE first_time >= SYSDATE - 1
    GROUP BY TO_CHAR(first_time, 'HH24:00')
    ORDER BY time_bucket ASC
  `,

  REDO_LOG_GROUPS: `
    SELECT 
      group#,
      thread#,
      sequence#,
      ROUND(bytes / (1024*1024), 2) AS size_mb,
      members,
      archived,
      status,
      TO_CHAR(first_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS first_time
    FROM v$log
    ORDER BY group#
  `,

  INSTANCE_RECOVERY: `
    SELECT 
      recovery_estimated_ios,
      actual_redo_blks,
      target_redo_blks,
      log_file_size_blks,
      estimated_mttr,
      target_mttr,
      ckpt_block_writes
    FROM v$instance_recovery
  `,

  // 6. ASM Diskgroups
  ASM_DISKS: `
    SELECT 
      group_number,
      name AS diskgroup_name,
      sector_size,
      block_size,
      allocation_unit_size,
      state,
      type AS redundancy_type,
      total_mb,
      free_mb,
      usable_file_mb,
      offline_disks,
      ROUND(((total_mb - free_mb) / NULLIF(total_mb, 0)) * 100, 2) AS used_pct,
      ROUND((free_mb / NULLIF(total_mb, 0)) * 100, 2) AS free_pct
    FROM v$asm_diskgroup
    ORDER BY diskgroup_name
  `,

  // 7. Background Processes Health
  BACKGROUND_PROCESSES: `
    SELECT 
      b.name AS process_name,
      b.description,
      b.error,
      p.spid AS os_pid,
      ROUND(NVL(p.pga_used_mem, 0) / (1024*1024), 2) AS pga_used_mb,
      ROUND(NVL(p.pga_alloc_mem, 0) / (1024*1024), 2) AS pga_alloc_mb,
      ROUND(NVL(p.pga_max_mem, 0) / (1024*1024), 2) AS pga_max_mb,
      CASE 
        WHEN b.error IS NOT NULL AND b.error != 0 THEN 'ERROR'
        WHEN p.spid IS NOT NULL THEN 'RUNNING' 
        ELSE 'STOPPED' 
      END AS status
    FROM v$bgprocess b
    LEFT JOIN v$process p ON b.paddr = p.addr
    WHERE b.name IN ('PMON', 'SMON', 'DBWR', 'LGWR', 'CKPT', 'MMON', 'MMNL', 'RECO', 'VKTM', 'DBW0', 'LG00')
       OR (b.paddr != '00' AND b.name LIKE 'ARC%')
    ORDER BY b.name
  `,

  // 8. Multitenant PDB Container Metrics
  PDB_CONTAINERS: `
    SELECT 
      con_id,
      dbid,
      name AS pdb_name,
      open_mode,
      restricted,
      TO_CHAR(open_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS open_time,
      ROUND(total_size / (1024*1024*1024), 2) AS total_size_gb,
      recovery_status
    FROM v$pdbs
    ORDER BY con_id
  `,

  PDB_RESOURCE_METRICS: `
    SELECT 
      m.con_id,
      p.name AS pdb_name,
      m.cpu_utilization_limit,
      m.avg_cpu_utilization AS cpu_pct_utilized,
      ROUND(m.cpu_consumed_time / 1000, 2) AS cpu_consumed_sec,
      ROUND(m.cpu_waiting_time / 1000, 2) AS cpu_waiting_sec,
      m.running_sessions_limit,
      m.avg_running_sessions,
      m.avg_waiting_sessions,
      m.iops,
      m.iombps
    FROM v$rsrc_pdb_metric m
    JOIN v$pdbs p ON m.con_id = p.con_id
    ORDER BY m.avg_cpu_utilization DESC
  `,

  PDB_SESSIONS: `
    SELECT 
      s.con_id,
      COALESCE(p.name, 'CDB$ROOT') AS pdb_name,
      COUNT(s.sid) AS total_sessions,
      COUNT(CASE WHEN s.status = 'ACTIVE' AND s.type != 'BACKGROUND' THEN 1 END) AS active_user_sessions,
      COUNT(CASE WHEN s.status = 'INACTIVE' THEN 1 END) AS inactive_sessions,
      COUNT(CASE WHEN s.blocking_session IS NOT NULL THEN 1 END) AS blocked_sessions
    FROM v$session s
    LEFT JOIN v$pdbs p ON s.con_id = p.con_id
    GROUP BY s.con_id, p.name
    ORDER BY active_user_sessions DESC
  `,

  // 9. Tablespaces & Autoextend Headroom
  TABLESPACE_CDB: `
    SELECT 
      df.con_id,
      COALESCE(p.name, 'CDB$ROOT') AS pdb_name,
      df.tablespace_name,
      ROUND(df.total_allocated_mb, 2) AS allocated_mb,
      ROUND(df.total_allocated_mb - NVL(fs.free_space_mb, 0), 2) AS used_mb,
      ROUND(NVL(fs.free_space_mb, 0), 2) AS free_mb,
      ROUND(df.max_extend_mb, 2) AS max_size_mb,
      ROUND(df.max_extend_mb - (df.total_allocated_mb - NVL(fs.free_space_mb, 0)), 2) AS total_headroom_mb,
      ROUND(((df.total_allocated_mb - NVL(fs.free_space_mb, 0)) / NULLIF(df.max_extend_mb, 0)) * 100, 2) AS used_pct_of_max,
      df.is_autoextensible
    FROM (
      SELECT 
        con_id,
        tablespace_name,
        SUM(bytes) / (1024*1024) AS total_allocated_mb,
        SUM(CASE WHEN autoextensible = 'YES' THEN maxbytes ELSE bytes END) / (1024*1024) AS max_extend_mb,
        MAX(autoextensible) AS is_autoextensible
      FROM cdb_data_files
      GROUP BY con_id, tablespace_name
    ) df
    LEFT JOIN (
      SELECT 
        con_id,
        tablespace_name,
        SUM(bytes) / (1024*1024) AS free_space_mb
      FROM cdb_free_space
      GROUP BY con_id, tablespace_name
    ) fs ON df.con_id = fs.con_id AND df.tablespace_name = fs.tablespace_name
    LEFT JOIN v$pdbs p ON df.con_id = p.con_id
    ORDER BY used_pct_of_max DESC
  `,

  TABLESPACE_STANDALONE: `
    SELECT 
      0 AS con_id,
      'STANDALONE' AS pdb_name,
      df.tablespace_name,
      ROUND(df.total_allocated_mb, 2) AS allocated_mb,
      ROUND(df.total_allocated_mb - NVL(fs.free_space_mb, 0), 2) AS used_mb,
      ROUND(NVL(fs.free_space_mb, 0), 2) AS free_mb,
      ROUND(df.max_extend_mb, 2) AS max_size_mb,
      ROUND(df.max_extend_mb - (df.total_allocated_mb - NVL(fs.free_space_mb, 0)), 2) AS total_headroom_mb,
      ROUND(((df.total_allocated_mb - NVL(fs.free_space_mb, 0)) / NULLIF(df.max_extend_mb, 0)) * 100, 2) AS used_pct_of_max,
      df.is_autoextensible
    FROM (
      SELECT 
        tablespace_name,
        SUM(bytes) / (1024*1024) AS total_allocated_mb,
        SUM(CASE WHEN autoextensible = 'YES' THEN maxbytes ELSE bytes END) / (1024*1024) AS max_extend_mb,
        MAX(autoextensible) AS is_autoextensible
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
    ORDER BY used_pct_of_max DESC
  `,

  // 10. Wait Classes & Events
  WAIT_CLASSES: `
    SELECT 
      wait_class,
      total_waits,
      ROUND(time_waited / 100, 2) AS time_waited_sec,
      ROUND((time_waited * 10) / NULLIF(total_waits, 0), 2) AS avg_wait_ms
    FROM v$system_wait_class
    WHERE wait_class != 'Idle'
    ORDER BY time_waited DESC
  `,

  TOP_WAIT_EVENTS: `
    SELECT 
      event,
      wait_class,
      total_waits,
      ROUND(time_waited_micro / 1000000, 2) AS time_waited_sec,
      ROUND(average_wait / 100, 2) AS avg_wait_ms
    FROM v$system_event
    WHERE wait_class NOT IN ('Idle')
    ORDER BY time_waited_micro DESC
    FETCH FIRST 10 ROWS ONLY
  `,

  BLOCKING_LOCKS: `
    SELECT 
      s.blocking_session AS blocker_sid,
      bs.serial# AS blocker_serial,
      bs.username AS blocker_username,
      bs.program AS blocker_program,
      bs.sql_id AS blocker_sql_id,
      s.sid AS blocked_sid,
      s.serial# AS blocked_serial,
      s.username AS blocked_username,
      s.program AS blocked_program,
      s.sql_id AS blocked_sql_id,
      s.seconds_in_wait,
      s.event AS wait_event,
      s.con_id,
      COALESCE(p.name, 'CDB$ROOT') AS pdb_name
    FROM v$session s
    JOIN v$session bs ON s.blocking_session = bs.sid
    LEFT JOIN v$pdbs p ON s.con_id = p.con_id
    WHERE s.blocking_session IS NOT NULL
    ORDER BY s.seconds_in_wait DESC
  `,

  // 11. Data Guard Replication
  DATAGUARD_STATS: `
    SELECT 
      name AS stat_name,
      value AS lag_formatted,
      unit,
      time_computed,
      datum_time
    FROM v$dataguard_stats
    WHERE name IN ('transport lag', 'apply lag', 'apply finish time', 'estimated startup time')
  `,

  ARCHIVE_DEST_STATUS: `
    SELECT 
      dest_id,
      dest_name,
      status,
      target,
      database_mode,
      recovery_mode,
      protection_mode,
      applied_seq#,
      gap_status,
      error
    FROM v$archive_dest_status
    WHERE status != 'INACTIVE'
  `,
};
