# Drizzle ORM + Postgres（替代 Redis 用法）

这个目录是一个 TypeScript 示例，受文章 [I replaced Redis with PostgreSQL and it's faster](https://dev.to/polliog/i-replaced-redis-with-postgresql-and-its-faster-4942) 启发，使用 Drizzle ORM 复刻其中的“用 PostgreSQL 替换 Redis”方案。

包含内容：
- 缓存：UNLOGGED 表 + TTL
- Pub/Sub：LISTEN/NOTIFY
- 任务队列：SKIP LOCKED
- Sessions：JSONB + TTL
- 限流：单条 upsert 原子更新

改进点：
- NOTIFY 只发送 id 作为信号，消费者再回表读取完整数据，避免 payload 限制与丢失。
- 关键写入/领取操作都保持单条 SQL，保证原子性。

## 详细文档（每个模块独立）

- 缓存：`docs/cache.md`
- Pub/Sub：`docs/pubsub.md`
- 队列：`docs/queue.md`
- Sessions：`docs/sessions.md`
- 限流：`docs/rate-limit.md`

每个文档都包含：
- 原理与为什么可行
- 与普通表的区别
- 推荐维护策略
- 监控与告警建议
- 参数与策略建议
- 压测与验收建议

## 原理概述

- 缓存（UNLOGGED + TTL）：UNLOGGED 表跳过 WAL 写入，写入更快；缓存用 `expires_at` 控制 TTL，读时过滤过期数据，后台定期清理。
- Pub/Sub（LISTEN/NOTIFY）：数据库内置轻量通知机制，适合“信号”，不保证持久与重放；示例里只通知 id，再回表取数据。
- 队列（SKIP LOCKED）：worker 通过 `FOR UPDATE SKIP LOCKED` 领取任务，避免多 worker 重复处理；领取与自增 attempts 在同一语句完成。
- Sessions（JSONB + TTL）：session 直接存 JSONB，可用索引与条件查询；TTL 由 `expires_at` 控制。
- 限流（upsert）：`INSERT ... ON CONFLICT DO UPDATE` 原子更新计数与窗口起点，避免并发竞争。

## 为什么可以这样做

PostgreSQL 的这些能力并不是“模拟 Redis”，而是数据库本身提供的并发控制、
通知机制和丰富的数据类型，让它可以覆盖部分 Redis 用途：

- 并发控制：行级锁 + `SKIP LOCKED` 让多 worker 竞争同一队列表而不冲突。
- 通知机制：`LISTEN/NOTIFY` 允许数据库直接向订阅者发事件信号。
- 写入优化：UNLOGGED 表绕过 WAL，换取更快写入（但会丢失崩溃后的数据）。
- 灵活数据结构：JSONB 支持半结构化存储与查询，适合 session、payload 等场景。
- 原子 upsert：`ON CONFLICT` 在单条语句里完成“检查 + 更新”，避免并发竞态。

核心原因是：这些操作都可以在同一事务、同一连接里完成，从而减少跨系统一致性问题。

## 与“普通表”使用的区别

- UNLOGGED 表：不写 WAL，速度更快，但崩溃后数据会被清空；普通表会崩溃恢复。
- LISTEN/NOTIFY：不是表读写，而是数据库事件通道；普通表无法主动通知订阅者。
- SKIP LOCKED：普通 `SELECT` 不会排队领取任务，必须结合锁机制才能避免重复消费。
- JSONB：普通表更多是固定列；JSONB 支持灵活结构与 JSON 运算符查询。
- 触发器 + pg_notify：插入表时自动发通知，普通表不具备“写入即广播”的行为。
- 维护成本：这些表/机制通常需要额外的清理、索引和 vacuum 策略。

## 优缺点

优点：
- 统一数据面：事务内可同时写业务数据、缓存失效、通知发布，减少一致性问题。
- 运维更简单：少一个依赖、备份/监控/故障域更集中。
- 成本可控：对中小系统通常比单独 Redis 更省。

缺点/注意点：
- 性能略慢：绝大多数操作在毫秒级，但高并发场景仍可能不及 Redis。
- LISTEN/NOTIFY 非可靠消息：进程断开会漏消息，需以表作为“真相源”。
- UNLOGGED 缓存会在崩溃后丢失；不适合必须持久的缓存数据。
- 队列表会增长：需要定期清理与 vacuum/索引维护。
- 极端吞吐下限流/队列可能成为热点，需要分片或保留 Redis。

> 💡 **维护策略**：缓存表推荐使用 pg_cron 定期清理 + VACUUM，详见 [`docs/cache.md`](docs/cache.md#推荐维护策略)。

## 适用场景

- 中小规模系统、对一致性和简化运维要求高的项目。
- 缓存/队列/限流逻辑相对简单，且可接受 0.1–1ms 的额外延迟。

## 不适用场景

- 需要 10 万+ ops/s 或更低延迟的系统。
- 大量使用 Redis 特有结构（zset/stream/geospatial 等）。
- 对可靠消息投递有严格保障要求的系统。

## 使用方式

1) 初始化表与触发器：

```bash
psql "$DATABASE_URL" -f sql/001_init.sql
```

2) 安装依赖（示例）：

```bash
npm i drizzle-orm pg
npm i -D tsx typescript
```

3) 运行示例：

```bash
node --loader tsx src/example.ts
```

## 文件说明

- src/db.ts：pg Pool + Drizzle 连接
- src/schema.ts：表结构定义
- src/cache.ts：缓存读写/清理
- src/pubsub.ts：LISTEN/NOTIFY + 日志监听
- src/queue.ts：入队/出队/完成/失败（SKIP LOCKED）
- src/sessions.ts：session upsert/get/清理
- src/rate-limit.ts：原子限流
- src/example.ts：快速演示

## 备注

- cache 使用 UNLOGGED，崩溃后会丢失，仅用于可丢弃缓存。
- LISTEN/NOTIFY 适合做信号，不适合当可靠消息队列。
- SKIP LOCKED 允许多 worker 并发拉取且不重复处理。
