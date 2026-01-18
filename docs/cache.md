# 缓存：UNLOGGED + TTL

## 概览
用 UNLOGGED 表承载缓存数据，配合 `expires_at` 字段实现 TTL。读时过滤过期数据，写时 upsert，后台清理过期行。

关联实现：`sql/001_init.sql`、`src/cache.ts`。

## 原理与为什么可行
- UNLOGGED 表跳过 WAL（写前日志），写入更快。
- TTL 通过 `expires_at` 控制，读请求只返回 `expires_at > now()` 的数据。
- 这种方式将缓存与业务数据放在同一数据库内，减少跨系统一致性问题。

## 与普通表的区别
- UNLOGGED 不写 WAL，崩溃恢复后表会被清空；普通表会在恢复时回放 WAL。
- UNLOGGED 变更不会被物理复制到只读副本；普通表会通过 WAL 同步。
- UNLOGGED 更适合“可丢数据”，普通表适合持久数据。

## 推荐维护策略

### 基本原则

- **过期清理**：定期执行 `DELETE FROM cache WHERE expires_at < now()`。
- **索引**：对 `expires_at` 建立索引（已在 `sql/001_init.sql` 中提供）。
- **Vacuum/Analyze**：定期 `VACUUM (ANALYZE) cache`，防止膨胀与统计信息过期。
- **容量控制**：设定合理 TTL，避免缓存表无限增长。
- **大小控制**：缓存 payload 以小对象为主，避免大 JSONB。

### 使用 pg_cron 自动化清理（推荐）

对于 UNLOGGED 缓存表，建议使用 pg_cron 定期清理过期数据并强制回收空间：

```sql
-- 安装 pg_cron 扩展（需要超级用户权限）
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 每 10 分钟清理过期缓存并回收空间
SELECT cron.schedule(
    'cache-cleanup-vacuum',
    '*/10 * * * *',
    $$
      DELETE FROM cache WHERE expires_at < NOW();
      VACUUM cache;
    $$
);

-- 查看已调度的任务
SELECT * FROM cron.job;

-- 删除任务（如需调整）
SELECT cron.unschedule('cache-cleanup-vacuum');
```

### 为什么推荐主动 VACUUM 而不是依赖 autovacuum

| 对比项 | autovacuum | 主动 VACUUM |
|--------|------------|-------------|
| 触发时机 | 默认 20% 死行才触发 | 定时执行，可控 |
| 响应速度 | 可能延迟数分钟 | 固定周期 |
| UNLOGGED 表 | 同样生效，但不优先 | 针对性优化 |
| 运维可见性 | 需监控 autovacuum 日志 | 任务调度清晰 |

UNLOGGED 表不写 WAL，VACUUM 开销比普通表小很多。普通 `VACUUM`（非 FULL）不会锁表，生产环境可以安全运行。

### 高频写入场景：分批删除

如果缓存表写入非常频繁，可考虑分批删除避免一次删太多行：

```sql
SELECT cron.schedule(
    'cache-cleanup-batch',
    '*/5 * * * *',
    $$
      DELETE FROM cache 
      WHERE ctid IN (
          SELECT ctid FROM cache 
          WHERE expires_at < NOW() 
          LIMIT 10000
      );
      VACUUM cache;
    $$
);
```

### 注意事项

- pg_cron 的任务块里每条语句是**独立执行**的（autocommit），不能用 `BEGIN/COMMIT` 包裹。
- 如果 DELETE 失败，VACUUM 仍会执行。
- 高频写入场景可适当降低清理频率（如 `*/30 * * * *`）。
- 清理任务应在业务低峰期更频繁执行。

### 监控清理效果

```sql
-- 查看表的死行数、最近 vacuum 时间
SELECT 
    relname,
    n_live_tup,
    n_dead_tup,
    last_vacuum,
    last_autovacuum,
    last_analyze
FROM pg_stat_user_tables
WHERE relname = 'cache';

-- 查看表大小
SELECT pg_size_pretty(pg_total_relation_size('cache')) AS cache_size;
```

## 监控与告警建议
- **表大小与膨胀**：监控 cache 表大小、dead tuples 增长与 autovacuum 触发频率。
- **读写延迟**：关注缓存读写 P95/P99 延迟（应用层指标更直观）。
- **锁等待**：监控 `pg_locks` 中的等待情况，避免清理与写入互相阻塞。
- **清理成功率**：定期清理任务是否按时执行、删除行数是否异常。

## 参数与策略建议
- **TTL**：根据业务选择（秒/分钟/小时级），避免极短 TTL 造成频繁写入。
- **清理频率**：通常 1–10 分钟一次；热点高时可更频繁。
- **行大小**：建议缓存对象保持小型化，避免过大 JSONB 影响 I/O。
- **索引策略**：高并发读取可考虑增加 `key` 或复合索引以降低扫描。

## 压测与验收建议
- **基准场景**：设置/读取/清理三类负载的并发压测。
- **验证指标**：缓存命中率、P95/P99 延迟、清理任务耗时与删除行数。
- **容量测试**：模拟达到预计峰值量，观察表增长与 vacuum 行为。

## 适用场景
- 读多写多但可容忍丢失的缓存（会话碎片、短时热点数据）。
- 需要强一致写入（写业务数据 + 失效缓存）在同一事务内完成的场景。

## 缺点 / 注意点
- **崩溃丢失**：数据库重启后 UNLOGGED 表会清空。
- **无复制**：不会出现在物理只读副本上。
- **性能上限**：虽然写入快，但仍受数据库整体负载影响。
- **不适合强一致持久缓存**：需要持久的数据不应放在 UNLOGGED。
