import { and, eq, gt, sql } from 'drizzle-orm';

import { db } from './db';
import { sessions } from './schema';

// Session 读取时校验过期时间。
export async function getSession<T>(id: string): Promise<T | undefined> {
  const [row] = await db
    .select({ data: sessions.data })
    .from(sessions)
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, sql`now()`)));

  return row?.data as T | undefined;
}

// Session 写入/更新采用 upsert，避免并发覆盖丢失。
export async function upsertSession(
  id: string,
  data: unknown,
  ttlSeconds = 86_400,
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  await db
    .insert(sessions)
    .values({ id, data, expiresAt })
    .onConflictDoUpdate({
      target: sessions.id,
      set: { data, expiresAt },
    });
}

export async function deleteSession(id: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, id));
}

// 定期清理过期 session。
export async function cleanupExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(sql`${sessions.expiresAt} < now()`);
}
