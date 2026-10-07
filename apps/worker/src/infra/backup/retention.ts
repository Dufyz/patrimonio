import type { DateOnly } from '@patrimonio/domain';

/**
 * A retenção escalonada do backup: 7 diários, 4 semanais, 6 mensais. É função
 * pura porque é a parte que erra em silêncio — uma política errada apaga a
 * cópia que você precisaria, e o teste é mais barato que a descoberta.
 */
export type BackupEntry = {
  readonly name: string;
  readonly date: DateOnly;
};

export type RetentionPolicy = {
  readonly daily: number;
  readonly weekly: number;
  readonly monthly: number;
};

export const DEFAULT_POLICY: RetentionPolicy = { daily: 7, weekly: 4, monthly: 6 };

export type RetentionPlan = {
  readonly keep: readonly string[];
  readonly remove: readonly string[];
};

const dayNumber = (date: DateOnly): number =>
  Math.floor(new Date(`${date}T00:00:00.000Z`).getTime() / 86_400_000);

/** Chave da semana ISO, para agrupar sem depender de biblioteca de data. */
const weekKey = (date: DateOnly): string => {
  const base = new Date(`${date}T00:00:00.000Z`);
  const day = base.getUTCDay() === 0 ? 7 : base.getUTCDay();
  base.setUTCDate(base.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(base.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((base.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);

  return `${base.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
};

const monthKey = (date: DateOnly): string => date.slice(0, 7);

/**
 * O mais recente de cada grupo, nos `limit` grupos mais recentes. O limite
 * existe porque a janela em dias não se alinha com a semana do calendário: 28
 * dias podem encostar em cinco semanas ISO, e a tabela promete quatro cópias.
 */
const newestPerGroup = (
  entries: readonly BackupEntry[],
  key: (date: DateOnly) => string,
  limit: number,
): BackupEntry[] => {
  const newest = new Map<string, BackupEntry>();

  for (const entry of entries) {
    const group = key(entry.date);
    const current = newest.get(group);
    if (current === undefined || entry.date > current.date) newest.set(group, entry);
  }

  return [...newest.entries()]
    .sort(([left], [right]) => (left < right ? 1 : -1))
    .slice(0, limit)
    .map(([, entry]) => entry);
};

/** A chave do mês `count` meses antes de `date`. */
const monthKeyBefore = (date: DateOnly, count: number): string => {
  const base = new Date(`${date}T00:00:00.000Z`);
  base.setUTCDate(1);
  base.setUTCMonth(base.getUTCMonth() - count);

  return base.toISOString().slice(0, 7);
};

/**
 * As faixas são de tempo, não de contagem: "um por semana nas últimas quatro
 * semanas", e não "as quatro semanas mais recentes que existirem no bucket".
 * A diferença aparece num bucket esparso — pela segunda leitura, um dump de
 * 2019 ficaria guardado para sempre por ser o mais recente do seu grupo.
 */
export const applyRetention = (
  entries: readonly BackupEntry[],
  today: DateOnly,
  policy: RetentionPolicy = DEFAULT_POLICY,
): RetentionPlan => {
  const todayNumber = dayNumber(today);
  const age = (entry: BackupEntry): number => todayNumber - dayNumber(entry.date);

  const sorted = [...entries].sort((left, right) => (left.date < right.date ? 1 : -1));

  const weeklyLimit = policy.daily + policy.weekly * 7;
  const monthlyFloor = monthKeyBefore(today, policy.monthly);

  // Últimos 7 dias: todos.
  const daily = sorted.filter((entry) => age(entry) < policy.daily);

  // As quatro semanas seguintes: o mais recente de cada semana.
  const weekly = newestPerGroup(
    sorted.filter((entry) => age(entry) >= policy.daily && age(entry) < weeklyLimit),
    weekKey,
    policy.weekly,
  );

  // Os seis meses seguintes: o mais recente de cada mês.
  const monthly = newestPerGroup(
    sorted.filter(
      (entry) => age(entry) >= weeklyLimit && monthKey(entry.date) >= monthlyFloor,
    ),
    monthKey,
    policy.monthly,
  );

  const keptNames = new Set([...daily, ...weekly, ...monthly].map((entry) => entry.name));

  return {
    keep: sorted.filter((entry) => keptNames.has(entry.name)).map((entry) => entry.name),
    remove: sorted
      .filter((entry) => !keptNames.has(entry.name))
      .map((entry) => entry.name),
  };
};
