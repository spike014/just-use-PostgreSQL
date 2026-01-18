// 表结构在 Drizzle 中定义，UNLOGGED 等物理属性在 SQL 里创建。
import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const cache = pgTable(
  'cache',
  {
    key: text('key').primaryKey(),
    value: jsonb('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    expiresIdx: index('idx_cache_expires').on(table.expiresAt),
  }),
);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    data: jsonb('data').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    expiresIdx: index('idx_sessions_expires').on(table.expiresAt),
  }),
);

export const jobs = pgTable(
  'jobs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    queue: text('queue').notNull(),
    payload: jsonb('payload').notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    queueScheduledIdx: index('idx_jobs_queue_scheduled').on(
      table.queue,
      table.scheduledAt,
    ),
  }),
);

export const rateLimits = pgTable('rate_limits', {
  userId: integer('user_id').primaryKey(),
  requestCount: integer('request_count').notNull().default(0),
  windowStart: timestamp('window_start', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const logs = pgTable('logs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
