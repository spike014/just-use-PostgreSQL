import { eq, sql } from 'drizzle-orm';
import type { PoolClient } from 'pg';

import { db, pool } from './db';
import { logs } from './schema';

// 发布只发通知信号，payload 适合轻量信息。
export async function publish(channel: string, payload: unknown): Promise<void> {
  const message = JSON.stringify(payload);
  await db.execute(sql`select pg_notify(${channel}, ${message})`);
}

export async function subscribe(
  channel: string,
  onMessage: (payload: unknown) => void,
): Promise<() => Promise<void>> {
  // LISTEN 需要安全的 channel 名，避免 SQL 注入。
  if (!/^[a-zA-Z0-9_]+$/.test(channel)) {
    throw new Error('Invalid channel name');
  }

  const client = await pool.connect();
  await client.query(`LISTEN ${channel}`);

  const handler = (msg: { channel: string; payload: string | null }) => {
    if (msg.channel !== channel || !msg.payload) {
      return;
    }

    try {
      onMessage(JSON.parse(msg.payload));
    } catch (error) {
      onMessage({ raw: msg.payload, error: (error as Error).message });
    }
  };

  client.on('notification', handler);

  return async () => {
    client.off('notification', handler);
    await client.query(`UNLISTEN ${channel}`);
    client.release();
  };
}

// 针对 logs 的监听：收到 id 后回表取完整记录。
export async function listenLogs(
  onLog: (log: typeof logs.$inferSelect) => void,
): Promise<() => Promise<void>> {
  const client: PoolClient = await pool.connect();
  await client.query('LISTEN logs_new');

  const handler = async (msg: { channel: string; payload: string | null }) => {
    if (msg.channel !== 'logs_new' || !msg.payload) {
      return;
    }

    const id = Number(msg.payload);
    if (!Number.isFinite(id)) {
      return;
    }

    const [row] = await db.select().from(logs).where(eq(logs.id, id));
    if (row) {
      onLog(row);
    }
  };

  client.on('notification', handler);

  return async () => {
    client.off('notification', handler);
    await client.query('UNLISTEN logs_new');
    client.release();
  };
}
