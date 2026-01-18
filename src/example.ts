import { db, pool } from './db';
import { logs } from './schema';
import { setCache, getCache } from './cache';
import { enqueue, dequeue, complete } from './queue';
import { publish, subscribe, listenLogs } from './pubsub';
import { checkRateLimit } from './rate-limit';
import { upsertSession, getSession } from './sessions';

// 给 LISTEN/NOTIFY 留出处理时间，方便演示。
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  // 缓存示例
  await setCache('user:123', { id: 123, name: 'Ada' }, 3600);
  const cached = await getCache<{ id: number; name: string }>('user:123');
  console.log('cache:', cached);

  // Session 示例
  await upsertSession('sess_1', { userId: 123, role: 'admin' }, 3600);
  const session = await getSession<{ userId: number; role: string }>('sess_1');
  console.log('session:', session);

  // 队列示例
  await enqueue('send-email', { to: 'user@example.com', subject: 'Hi' });
  const job = await dequeue('send-email');
  if (job) {
    console.log('job:', job.id, job.payload);
    await complete(job.id);
  }

  // Pub/Sub 示例
  const unsubscribe = await subscribe('notifications', (payload) => {
    console.log('notify:', payload);
  });
  await publish('notifications', { userId: 123, msg: 'Hello' });
  await sleep(50);
  await unsubscribe();

  // 触发器 + 回表读取示例
  const stopLogs = await listenLogs((log) => {
    console.log('log row:', log.id, log.payload);
  });
  await db.insert(logs).values({ payload: { level: 'info', message: 'hello' } });
  await sleep(50);
  await stopLogs();

  // 限流示例
  const rate = await checkRateLimit(123, 5, 60);
  console.log('rate limit:', rate);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
