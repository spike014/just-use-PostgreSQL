# Drizzle ORM + Postgres ( 用 `Postgres` 替代 `Redis` )

如果你不想多維護一個 `Redis` ，可以用 `PostgreSQL` 實現快取、隊列、 `Session` 和限流。這個專案受 `[I replaced Redis with PostgreSQL and it's faster](https://dev.to/polliog/i-replaced-redis-with-postgresql-and-its-faster-4942)` 啟發，使用 `Drizzle ORM` 提供了各種典型場景的實現範例。

## 為什麼這麼做？
- **省事**：少一個依賴組件，運維更簡單，備份、擴容、監控都更集中。
- **一致性**：業務數據和快取/隊列寫在同一個資料庫交易裡，要麼全成功，要麼全失敗，不用擔心「消息發了但數據沒存上」的問題。
- **省錢**：中小規模下直接複用資料庫資源，不需要額外購買或配置 `Redis` 集群。

## 核心功能與原理

| 功能 | 實現方式 | 特點 | 詳細文件 |
| :--- | :--- | :--- | :--- |
| **快取** | `UNLOGGED` 表 + `TTL` | **快**。不記錄日誌，崩潰會丟數據，適合純快取。 | `[docs/cache.md](docs/cache.md)` |
| **Pub/Sub** | `LISTEN/NOTIFY` | **輕**。適合發信號。進階可用 `[docs/pubsub.md](docs/pubsub.md)` 了解 `PGMQ` 實現高可靠隊列。 | `[docs/pubsub.md](docs/pubsub.md)` |
| **任務隊列** | `SKIP LOCKED` | **併發安全**。多進程搶任務不鎖表，不重複消費。 | `[docs/queue.md](docs/queue.md)` |
| **Session** | `JSONB` + `TTL` | **靈活**。適合存複雜的 `Session` ，支持快速查詢。 | `[docs/sessions.md](docs/sessions.md)` |
| **限流** | `UPSERT` 原子更新 | **準**。單條 `SQL` 完成「檢查+扣減」，無併發競態。 | `[docs/rate-limit.md](docs/rate-limit.md)` |

## 快速上手

1. **初始化表**：
   ```bash
   psql "$DATABASE_URL" -f sql/001_init.sql
   ```
2. **安裝依賴**：
   ```bash
   npm i drizzle-orm pg
   ```
3. **執行演示**：
   ```bash
   node --loader tsx src/example.ts
   ```

## 適用與局限

- **推薦用**：中小規模系統、對開發效率和運維成本敏感、需要交易保證的場景。
- **不推薦用**：每秒 `100,000` + 的超高併發、對延遲有極致要求 ( < `0.1` `ms` )、大量使用 `Redis` 特有資料結構 ( 如 `ZSET` 、 `Geo` ) 的情況。

## 維護建議
- **定期清理**：快取和 `Session` 表需要定期刪掉過期數據 ( 推薦用 `pg_cron` )，防止表無限變大。
- **監控死行**：頻繁更新的隊列表需要關注 `VACUUM` 情況，建議調激進一點。
- **詳細維護指南見各模組文件。**
