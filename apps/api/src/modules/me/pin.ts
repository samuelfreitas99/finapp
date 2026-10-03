import { randomBytes, scrypt, timingSafeEqual, type BinaryLike } from 'node:crypto';

const KEY_LENGTH = 32;
const COST = 16384;

const derive = (pin: string, salt: BinaryLike) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(pin, salt, KEY_LENGTH, { N: COST }, (err, key) => (err ? reject(err) : resolve(key)));
  });

/** PIN com sal aleatório: `scrypt$<sal em hex>$<hash em hex>`. */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(pin, salt);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await derive(pin, Buffer.from(saltHex, 'hex'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Limite de tentativas por usuário (em memória): 5 erros seguidos bloqueiam por 1 minuto.
 * O PIN é curto, então a trava é o que impede adivinhar.
 */
export class PinThrottle {
  private readonly state = new Map<string, { fails: number; until: number }>();

  constructor(
    private readonly maxFails = 5,
    private readonly lockMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Segundos de espera restantes, ou 0 se pode tentar. */
  waitSeconds(userId: string): number {
    const s = this.state.get(userId);
    if (!s || s.until <= this.now()) return 0;
    return Math.ceil((s.until - this.now()) / 1000);
  }

  fail(userId: string): void {
    const s = this.state.get(userId);
    const fails = (s && s.until > 0 && s.until <= this.now() ? 0 : (s?.fails ?? 0)) + 1;
    this.state.set(userId, {
      fails,
      until: fails >= this.maxFails ? this.now() + this.lockMs : 0,
    });
  }

  success(userId: string): void {
    this.state.delete(userId);
  }
}
