import { sql } from 'drizzle-orm';

import { db } from './db';

export type RateLimitResult = {
  allowed: boolean;
  requestCount: number;
  windowStart: Date;
};

// 单条 upsert 实现原子计数与窗口重置。
export async function checkRateLimit(
  userId: number,
  maxRequests: number,
  windowSeconds = 60,
): Promise<RateLimitResult> {
  const result = await db.execute(sql`
    INSERT INTO rate_limits (user_id, request_count, window_start)
    VALUES (${userId}, 1, now())
    ON CONFLICT (user_id)
    DO UPDATE SET
      request_count = CASE
        WHEN rate_limits.window_start < now() - (${windowSeconds} || ' seconds')::interval
        THEN 1
        ELSE rate_limits.request_count + 1
      END,
      window_start = CASE
        WHEN rate_limits.window_start < now() - (${windowSeconds} || ' seconds')::interval
        THEN now()
        ELSE rate_limits.window_start
      END
    RETURNING request_count, window_start
  `);

  const row = (result as unknown as { rows: { request_count: number; window_start: Date }[] })
    .rows?.[0];

  if (!row) {
    return { allowed: false, requestCount: 0, windowStart: new Date(0) };
  }

  return {
    allowed: row.request_count <= maxRequests,
    requestCount: row.request_count,
    windowStart: row.window_start,
  };
}
