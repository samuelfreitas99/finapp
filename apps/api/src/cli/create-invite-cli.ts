import { createAdminInvite } from './create-invite';

const url = process.env.DATABASE_URL ?? 'postgres://finapp:finapp@127.0.0.1:5433/finapp';
const days = Number(process.argv[2] ?? 7);
console.log(`Convite: ${await createAdminInvite(url, days)} (vale ${days} dias)`);
