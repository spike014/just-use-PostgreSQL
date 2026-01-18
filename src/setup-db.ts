
import { Client } from 'pg';
import fs from 'fs';
import path from 'path';

async function setup() {
  const baseConnectionString = 'postgresql://user:password@localhost:5432';
  const dbName = 'drizzle_pg_redis';
  
  // 1. Connect to postgres to create the new database
  const client = new Client({
    connectionString: baseConnectionString + '/postgres'
  });

  try {
    await client.connect();
    console.log('Connected to PostgreSQL server.');
    
    // Check if DB exists
    const res = await client.query(`SELECT 1 FROM pg_database WHERE datname = '${dbName}'`);
    if (res.rowCount === 0) {
      await client.query(`CREATE DATABASE ${dbName}`);
      console.log(`Database "${dbName}" created.`);
    } else {
      console.log(`Database "${dbName}" already exists.`);
    }
  } catch (err) {
    console.error('Error creating database:', err);
    process.exit(1);
  } finally {
    await client.end();
  }

  // 2. Connect to the new database and run init.sql
  const dbClient = new Client({
    connectionString: baseConnectionString + '/' + dbName
  });

  try {
    await dbClient.connect();
    console.log(`Connected to database "${dbName}".`);
    
    const sqlPath = path.join(__dirname, '../sql/001_init.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log('Running init.sql...');
    await dbClient.query(sql);
    console.log('Initialization complete.');
    
    console.log('\nSuccess! You can now run the example with:');
    console.log(`DATABASE_URL=${baseConnectionString}/${dbName} npx tsx src/example.ts`);
  } catch (err) {
    console.error('Error initializing database:', err);
    process.exit(1);
  } finally {
    await dbClient.end();
  }
}

setup();
