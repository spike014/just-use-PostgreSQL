import { and, eq, gt, sql } from 'drizzle-orm';

import { db } from './db';
import { cache } from './schema';

// 读取时同时校验过期时间，避免返回脏缓存。
export async function getCache<T>(key: string): Promise<T | undefined> {
  const [row] = await db
    .select({ value: cache.value })
    .from(cache)
    .where(and(eq(cache.key, key), gt(cache.expiresAt, sql`now()`)));

  return row?.value as T | undefined;
}

// 写入时计算 TTL 对应的过期时间，使用 upsert 保持幂等。
export async function setCache(
  key: string,
  value: unknown,
  ttlSeconds = 3600,
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  await db
    .insert(cache)
    .values({ key, value, expiresAt })
    .onConflictDoUpdate({
      target: cache.key,
      set: { value, expiresAt },
    });
}

export async function deleteCache(key: string): Promise<void> {
  await db.delete(cache).where(eq(cache.key, key));
}

// 定期清理过期缓存（可配合 cron 或定时任务）。
export async function cleanupExpiredCache(): Promise<void> {
  await db.delete(cache).where(sql`${cache.expiresAt} < now()`);
}
