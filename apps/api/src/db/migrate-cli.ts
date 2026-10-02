import { runMigrations } from './migrate';

const url = process.env.DATABASE_URL ?? 'postgres://finapp:finapp@127.0.0.1:5433/finapp';
await runMigrations(url);
console.log('Migrações aplicadas.');
