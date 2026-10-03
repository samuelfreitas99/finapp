import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createAuth } from '../../auth/auth';
import { createAdminInvite } from '../../cli/create-invite';
import { createTempDb, testDatabaseUrl } from '../../test/temp-db';

const appUrl = 'http://localhost:5174';
const TODAY = '2026-10-15';

describe.skipIf(!testDatabaseUrl)(
  'property debts: handover date, monthly values and index (integration)',
  () => {
    let drop: () => Promise<void>;
    let app: ReturnType<typeof buildApp>;
    let cookie: string;
    let spaceId: string;
    let accountId: string;

    type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
    const api = (method: Method, path: string, payload?: unknown) =>
      app.inject({
        method,
        url: `/api/spaces/${spaceId}${path}`,
        headers: { cookie, origin: appUrl },
        ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
      });

    beforeAll(async () => {
      const temp = await createTempDb();
      drop = temp.drop;
      const auth = createAuth({
        db: temp.db,
        secret: 'test-secret-test-secret-test-secret-00',
        appUrl,
        production: false,
      });
      app = buildApp({ db: temp.db, auth, appUrl, today: () => TODAY });
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin: appUrl },
        payload: {
          name: 'Samuel',
          email: 'samuel@ex.com',
          password: 'senha-forte-1',
          inviteCode: await createAdminInvite(temp.url),
        },
      });
      const raw = res.headers['set-cookie'];
      cookie = (Array.isArray(raw) ? raw : [String(raw)]).map((c) => c.split(';')[0]).join('; ');
      spaceId = (await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json()
        .activeSpaceId;
      accountId = (
        await api('POST', '/accounts', {
          name: 'Conta',
          type: 'checking',
          initialBalance: 0,
          initialDate: '2026-01-01',
        })
      ).json().id;
    });

    afterAll(async () => {
      await app?.close();
      await drop?.();
    });

    const property = () =>
      api('POST', '/debts', {
        name: 'Apto Centro',
        kind: 'property',
        completionDate: '2027-03-31',
        paymentAccountId: accountId,
        phases: [
          {
            name: 'Entrada',
            system: 'fixed',
            installments: 3,
            installmentAmount: 10000,
            firstDueDate: '2026-11-10',
            index: 'incc',
          },
          {
            name: 'Juros de obra',
            system: 'variable',
            firstDueDate: '2026-11-15',
            endsAtCompletion: true,
            values: [{ month: '2026-11', amount: 3000 }],
          },
          {
            name: 'Financiamento',
            system: 'price',
            principal: 100000,
            rateMonthly: 0.01,
            installments: 12,
            firstDueDate: '2027-01-10',
            startsAfterCompletion: true,
          },
        ],
      });

    type Inst = {
      phaseId: string;
      dueDate: string;
      amount: number;
      estimated: boolean;
      status: string;
      number: number;
    };
    const phaseRows = (
      d: { phases: { id: string; name: string }[]; installments: Inst[] },
      name: string,
    ) => {
      const id = d.phases.find((p) => p.name === name)?.id;
      return d.installments.filter((i) => i.phaseId === id);
    };

    it('sets monthly values of the construction-interest phase (RN 6.1)', async () => {
      const debt = (await property()).json();
      expect(phaseRows(debt, 'Juros de obra').map((i) => i.dueDate)).toEqual([
        '2026-11-15',
        '2026-12-15',
        '2027-01-15',
        '2027-02-15',
        '2027-03-15',
      ]);
      const works = debt.phases.find((p: { name: string }) => p.name === 'Juros de obra');
      const res = (
        await api('POST', `/debts/${debt.id}/phases/${works.id}/values`, {
          month: '2026-12',
          amount: 3500,
        })
      ).json();
      expect(phaseRows(res, 'Juros de obra').map((i) => [i.amount, i.estimated])).toEqual([
        [3000, false],
        [3500, false],
        [3500, true],
        [3500, true],
        [3500, true],
      ]);
      expect(
        (
          await api('POST', `/debts/${debt.id}/phases/${works.id}/values`, {
            month: '2028-01',
            amount: 1,
          })
        ).json().error.code,
      ).toBe('invalid_month');
    });

    it('moves the handover date, regenerating only pending installments (RN 6.7)', async () => {
      const debt = (await property()).json();
      await api('POST', `/debts/${debt.id}/installments/1/pay`, {}); // entrada 1 (10/11)
      const res = await api('PATCH', `/debts/${debt.id}/completion-date`, {
        completionDate: '2027-05-31',
      });
      expect(res.statusCode).toBe(200);
      const after = res.json();
      expect(after.completionDate).toBe('2027-05-31');
      expect(phaseRows(after, 'Juros de obra')).toHaveLength(7); // nov a mai
      const fin = phaseRows(after, 'Financiamento');
      expect(fin).toHaveLength(12);
      expect(fin[0]?.dueDate).toBe('2027-06-10');
      expect(after.installments.find((i: Inst) => i.number === 1)).toMatchObject({
        status: 'paid',
      });
      expect(after.installments.map((i: Inst) => i.number)).toEqual(
        after.installments.map((_: unknown, k: number) => k + 1),
      );
      // Previstos acompanham: 12 do financiamento + 7 de juros + 2 entradas pendentes.
      const planned = (
        await api(
          'GET',
          `/transactions?limit=200&status=planned&q=${encodeURIComponent('Apto Centro')}`,
        )
      ).json().items;
      expect(planned.length).toBeGreaterThanOrEqual(21);
    });

    it('applies the monthly index to pending installments of the phase (RN 6.2)', async () => {
      const debt = (await property()).json();
      const entrada = debt.phases.find((p: { name: string }) => p.name === 'Entrada');
      const fin = debt.phases.find((p: { name: string }) => p.name === 'Financiamento');
      expect(
        (
          await api('POST', `/debts/${debt.id}/phases/${entrada.id}/index`, { month: '2026-11' })
        ).json().error.code,
      ).toBe('index_value_missing');
      expect(
        (await api('POST', '/index-values', { index: 'incc', month: '2026-11', value: 0.01 }))
          .statusCode,
      ).toBe(201);
      const list = (await api('GET', '/index-values')).json().items;
      expect(list).toContainEqual({
        index: 'incc',
        month: '2026-11',
        value: 0.01,
        source: 'manual',
      });

      const res = (
        await api('POST', `/debts/${debt.id}/phases/${entrada.id}/index`, { month: '2026-11' })
      ).json();
      expect(phaseRows(res, 'Entrada').map((i) => i.amount)).toEqual([10100, 10100, 10100]);
      expect(
        (
          await api('POST', `/debts/${debt.id}/phases/${entrada.id}/index`, { month: '2026-11' })
        ).json().error.code,
      ).toBe('index_already_applied');
      expect(
        (await api('POST', `/debts/${debt.id}/phases/${fin.id}/index`, { month: '2026-11' })).json()
          .error.code,
      ).toBe('no_index');
    });

    it('keeps the contract deadline and confirms the real handover ("Recebi as chaves")', async () => {
      const res = await api('POST', '/debts', {
        name: 'Apto Leste',
        kind: 'property',
        completionDate: '2027-10-31',
        completionDeadline: '2029-09-30',
        paymentAccountId: accountId,
        phases: [
          {
            name: 'Juros de obra',
            system: 'variable',
            firstDueDate: '2026-11-15',
            endsAtCompletion: true,
            values: [{ month: '2026-11', amount: 1000 }],
          },
          {
            name: 'Financiamento',
            system: 'price',
            principal: 100000,
            rateMonthly: 0.01,
            installments: 12,
            firstDueDate: '2027-01-10',
            startsAfterCompletion: true,
          },
        ],
      });
      const debt = res.json();
      expect(debt).toMatchObject({ completionDeadline: '2029-09-30', completionConfirmed: false });
      const keys = (
        await api('PATCH', `/debts/${debt.id}/completion-date`, {
          completionDate: '2027-08-20',
          confirmed: true,
        })
      ).json();
      expect(keys).toMatchObject({ completionDate: '2027-08-20', completionConfirmed: true });
      expect(phaseRows(keys, 'Juros de obra').at(-1)?.dueDate).toBe('2027-08-15');
      expect(phaseRows(keys, 'Financiamento')[0]?.dueDate).toBe('2027-09-10');
      expect(
        (
          await api('PATCH', `/debts/${debt.id}/completion-date`, { completionDate: '2027-09-01' })
        ).json().error.code,
      ).toBe('completion_confirmed');
    });
  },
);
