import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

// 统一从环境变量读取连接串，便于部署和本地切换。
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required');
}

// 复用连接池，降低频繁连接的开销。
export const pool = new Pool({ connectionString });
// Drizzle 使用 pg 连接池作为底层 client。
export const db = drizzle({ client: pool });
