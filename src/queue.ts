import { eq, sql } from 'drizzle-orm';

import { db } from './db';
import { jobs } from './schema';

export type JobRow = typeof jobs.$inferSelect;

export async function enqueue(
  queue: string,
  payload: unknown,
  scheduledAt: Date = new Date(),
): Promise<void> {
  // 入队仅写一行，后续由 worker 领取。
  await db.insert(jobs).values({ queue, payload, scheduledAt });
}

export async function dequeue(queue: string): Promise<JobRow | null> {
  // SKIP LOCKED 允许多 worker 并发领取，避免重复处理。
  const result = await db.execute(sql`
    WITH next_job AS (
      SELECT id
      FROM jobs
      WHERE queue = ${queue}
        AND attempts < max_attempts
        AND scheduled_at <= now()
      ORDER BY scheduled_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE jobs
    SET attempts = attempts + 1
    FROM next_job
    WHERE jobs.id = next_job.id
    RETURNING jobs.*
  `);

  const rows = (result as unknown as { rows: JobRow[] }).rows;
  return rows?.[0] ?? null;
}

export async function complete(jobId: number): Promise<void> {
  // 完成即删除，避免表持续膨胀。
  await db.delete(jobs).where(eq(jobs.id, jobId));
}

export async function fail(jobId: number, error: Error): Promise<void> {
  // 失败时记录错误并耗尽尝试次数，防止反复重试。
  await db.execute(sql`
    UPDATE jobs
    SET attempts = max_attempts,
        payload = payload || jsonb_build_object('error', ${error.message})
    WHERE id = ${jobId}
  `);
}
