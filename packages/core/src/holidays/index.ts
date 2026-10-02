import { addDays, toISODate, type ISODate } from '../dates';

/**
 * Feriados nacionais brasileiros, calculados sem dependência externa.
 * @see RN 2
 */

export interface Holiday {
  date: ISODate;
  name: string;
}

export interface NationalHolidayOptions {
  /**
   * Segunda e terça de Carnaval (ponto facultativo). Padrão `true`: os bancos não
   * abrem, então vencimentos e pagamentos não acontecem nesses dias.
   */
  carnival?: boolean;
  /** Corpus Christi (ponto facultativo). Padrão `true`, pelo mesmo motivo. */
  corpusChristi?: boolean;
}

/**
 * Domingo de Páscoa (calendário gregoriano), algoritmo de Meeus/Jones/Butcher.
 * @see RN 2
 */
export function easterSunday(year: number): ISODate {
  if (!Number.isInteger(year) || year < 1583) throw new RangeError(`ano inválido: ${year}`);
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toISODate(year, month, day);
}

const FIXED: ReadonlyArray<readonly [number, number, string]> = [
  [1, 1, 'Confraternização Universal'],
  [4, 21, 'Tiradentes'],
  [5, 1, 'Dia do Trabalho'],
  [9, 7, 'Independência do Brasil'],
  [10, 12, 'Nossa Senhora Aparecida'],
  [11, 2, 'Finados'],
  [11, 15, 'Proclamação da República'],
  [11, 20, 'Dia Nacional de Zumbi e da Consciência Negra'],
  [12, 25, 'Natal'],
];

/**
 * Feriados nacionais do ano (fixos + móveis a partir da Páscoa), em ordem de data.
 * @see RN 2
 */
export function nationalHolidays(
  year: number,
  { carnival = true, corpusChristi = true }: NationalHolidayOptions = {},
): Holiday[] {
  const easter = easterSunday(year);
  const list: Holiday[] = FIXED.map(([month, day, name]) => ({
    date: toISODate(year, month, day),
    name,
  }));
  if (carnival) {
    list.push({ date: addDays(easter, -48), name: 'Carnaval (segunda-feira)' });
    list.push({ date: addDays(easter, -47), name: 'Carnaval (terça-feira)' });
  }
  list.push({ date: addDays(easter, -2), name: 'Sexta-feira Santa' });
  if (corpusChristi) list.push({ date: addDays(easter, 60), name: 'Corpus Christi' });
  return list.sort((x, y) => x.date.localeCompare(y.date));
}

/** Conjunto de datas de feriados nacionais de `fromYear` a `toYear` (inclusive). */
export function nationalHolidayDates(
  fromYear: number,
  toYear: number = fromYear,
  options?: NationalHolidayOptions,
): Set<ISODate> {
  const set = new Set<ISODate>();
  for (let y = fromYear; y <= toYear; y++) {
    for (const h of nationalHolidays(y, options)) set.add(h.date);
  }
  return set;
}
