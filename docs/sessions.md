# Sessions：JSONB + TTL

## 概览
将 session 作为 JSONB 存入表中，通过 `expires_at` 控制过期，支持灵活字段与查询。

关联实现：`sql/001_init.sql`、`src/sessions.ts`。

## 原理与为什么可行
- JSONB 允许存储半结构化数据，并支持 JSON 运算符查询。
- TTL 通过 `expires_at` 控制，读时过滤过期数据。
- 与业务表同库可进行事务级一致写入。

## 与普通表的区别
- 普通表是固定列，JSONB 允许动态结构。
- JSONB 查询可用 GIN 索引（普通列是 B-Tree 为主）。
- 需要定期清理过期 session，普通持久表通常不删。

## 推荐维护策略
- **过期清理**：定期删除 `expires_at < now()` 的行。
- **索引**：对 `expires_at` 建索引；若按 JSON 字段查询，可增加 GIN 索引。
- **数据约束**：JSONB 灵活但缺约束，必要时在应用层校验结构。
- **大小控制**：避免过大的 session，减少 I/O。

## 监控与告警建议
- **活跃量**：监控 sessions 表行数与过期占比。
- **清理效果**：清理任务耗时与删除行数是否异常。
- **查询性能**：关注 JSONB 查询的慢查询与索引命中情况。
- **表膨胀**：监控 dead tuples 与表大小变化。

## 参数与策略建议
- **TTL**：按业务安全策略设定（如 30 分钟/24 小时）。
- **结构约束**：对关键字段在应用层做校验，避免数据漂移。
- **索引策略**：高频 JSON 字段可建立 GIN/表达式索引。
- **大小控制**：建议仅存必要字段，避免嵌入大对象。

## 压测与验收建议
- **登录高峰**：模拟大量 session 新建与更新。
- **读取并发**：验证多用户读取/校验 session 的延迟。
- **过期清理**：在高数据量下测试清理耗时与影响。

## 适用场景
- 服务端 session、用户临时状态、需要按 JSON 字段过滤的场景。
- 需要与业务写入保持事务一致的 session 体系。

## 缺点 / 注意点
- **结构不强约束**：JSONB 缺少列级约束。
- **性能成本**：JSONB 更新通常写整列。
- **需要清理**：过期数据不清理会膨胀。

## 典型使用场景

| 场景 | 说明 |
|------|------|
| **Web 应用登录态** | 用户登录后，session_id → 用户信息的映射 |
| **购物车临时数据** | 未登录用户的临时购物车 |
| **表单多步骤暂存** | 多步骤表单的中间状态 |
| **验证码/Token 缓存** | 短信验证码、邮箱验证 token |
| **OAuth 临时状态** | OAuth 授权流程中的 state 参数 |
| **用户偏好/临时配置** | 主题、语言等临时设置 |

## 数据结构示例

```sql
-- session 表结构
CREATE TABLE sessions (
    id         TEXT PRIMARY KEY,           -- session_id
    data       JSONB NOT NULL,             -- 灵活的 session 数据
    expires_at TIMESTAMPTZ NOT NULL        -- 过期时间（TTL）
);

-- 创建过期时间索引（加速清理查询）
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- 示例数据
INSERT INTO sessions (id, data, expires_at) VALUES
('sess_abc123', 
 '{"user_id": 42, "role": "admin", "theme": "dark"}', 
 NOW() + INTERVAL '24 hours');

-- 读取 session（自动过滤过期）
SELECT data FROM sessions 
WHERE id = 'sess_abc123' AND expires_at > NOW();

-- 更新 session（续期 + 更新数据）
UPDATE sessions SET 
    data = data || '{"last_active": "2024-01-01T12:00:00Z"}',
    expires_at = NOW() + INTERVAL '24 hours'
WHERE id = 'sess_abc123';

-- 按 JSONB 字段查询（需要 GIN 索引）
SELECT * FROM sessions 
WHERE data @> '{"role": "admin"}' AND expires_at > NOW();
```

## 与 Redis Session 的对比

| 对比项 | Redis | PostgreSQL (本方案) |
|--------|-------|---------------------|
| 数据结构 | 字符串/Hash | JSONB（灵活查询） |
| 过期方式 | 自动 TTL（EXPIRE） | `expires_at` 字段 + 定期清理 |
| 查询能力 | 只能按 key 查 | 可按 JSON 字段查询、聚合统计 |
| 事务一致性 | 需要两阶段提交 | 与业务表同一事务 ✅ |
| 持久化 | 可选（RDB/AOF） | 默认持久 |
| 延迟 | ~0.1-0.5ms | ~1-5ms |
| 运维复杂度 | 需要额外维护 Redis | 复用现有 PG |
| 横向扩展 | Redis Cluster | 相对困难 |

## ✨ 核心优势：事务一致性

使用 PostgreSQL 存储 session 的最大优势是**与业务数据在同一事务中操作**：

```sql
-- ❌ 传统方案（Redis + PG）：两个系统，可能不一致
BEGIN;
  INSERT INTO orders (user_id, amount) VALUES (42, 99.00);
  -- 如果这里挂了，Redis session 可能没更新
COMMIT;
-- 非事务操作，可能失败
HSET session:sess_abc123 last_order_id 1001

-- ✅ 本方案（纯 PG）：同一事务，保证一致
BEGIN;
  INSERT INTO orders (user_id, amount) VALUES (42, 99.00);
  UPDATE sessions 
  SET data = data || '{"last_order_id": 1001}'
  WHERE id = 'sess_abc123';
COMMIT;  -- 要么都成功，要么都回滚
```

典型应用场景：

- 下单时更新 session 中的"最近订单"
- 登录时同时写入审计日志和 session
- 修改密码后立即使所有 session 失效

## 性能参考

| 操作 | 延迟（中等负载） | 说明 |
|------|-----------------|------|
| 读取 session | 1-3 ms | 主键查询，走索引 |
| 写入/更新 session | 2-5 ms | JSONB 整列更新 |
| 按 JSON 字段查询 | 5-20 ms | 取决于索引和数据量 |

对比 Redis（通常 0.1-0.5ms），PostgreSQL 慢一个数量级，但对大多数 Web 应用来说**完全可接受**。

## 适用人群

| ✅ 适合 | ❌ 不适合 |
|---------|----------|
| 中小规模应用（< 10 万并发 session） | 超高并发（百万级 session） |
| 需要查询 session 内容（如"查所有管理员会话"） | 只需简单 key-value 存取 |
| 要求业务数据与 session 强一致性 | 对延迟极度敏感（< 1ms） |
| 想减少组件（不想维护 Redis） | 已有完善的 Redis 集群 |
| 需要 session 数据的 SQL 分析 | 海量临时数据 |

## 从 Redis 迁移的注意事项

如果你从 Redis session 迁移到 PostgreSQL：

1. **TTL 机制不同**
   - Redis：设置 EXPIRE，自动删除
   - PG：需要定期清理任务
   ```sql
   -- 每 10 分钟清理过期 session
   SELECT cron.schedule('cleanup-sessions', '*/10 * * * *',
       $$DELETE FROM sessions WHERE expires_at < NOW()$$
   );
   ```

2. **Session ID 生成**
   - 继续使用原有的 session ID 生成逻辑
   - 确保 ID 足够随机（防止猜测攻击）

3. **并发更新**
   - Redis 的 HSET 是原子的
   - PG 的 JSONB 更新也是原子的，但要注意 `||` 合并的行为

4. **批量查询 session**
   - Redis：需要 SCAN 或维护二级索引
   - PG：直接 SQL 查询，更灵活
   ```sql
   -- 查询所有管理员的活跃 session
   SELECT * FROM sessions 
   WHERE data->>'role' = 'admin' AND expires_at > NOW();
   
   -- 统计当前活跃 session 数
   SELECT COUNT(*) FROM sessions WHERE expires_at > NOW();
   ```

