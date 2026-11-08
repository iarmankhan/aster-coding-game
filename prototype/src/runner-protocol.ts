import { missionCatalog, missionIds } from './mission-catalog';
export type RunnerEntry = typeof missionCatalog[typeof missionIds[number]]['entry'];
export const entryArities = Object.freeze(Object.fromEntries(missionIds.map((id) => [missionCatalog[id].entry, missionCatalog[id].args.length])) as Record<RunnerEntry, number>);
export type RunnerFixture = { id: string; args: unknown[] };
export type FixtureResult =
  | { ok: true; value: unknown; logs: string[] }
  | { ok: false; error: string; logs: string[] };
export type BatchResult =
  | { ok: true; results: FixtureResult[] }
  | { ok: false; results: FixtureResult[]; error: string; fixtureIndex: number | null };
export type WireBatch = {
  type: 'batch'; attempt: number; entry: RunnerEntry; javascript: string;
  fixtures: { id: string; argsJSON: string }[];
};

export const LIMITS = Object.freeze({
  memoryBytes: 24 * 1024 * 1024, stackBytes: 128 * 1024, runtimeMs: 400,
  bootMs: 30000, fixtureMs: 1000, sourceChars: 65536, compiledChars: 262144,
  argsChars: 262144, batchArgsChars: 8 * 262144, envelopeChars: 262144,
  fixtures: 8, routeNodes: 100, arrayItems: 200, depth: 16, nodes: 4096,
  idChars: 256, logLines: 20, logChars: 2000, errorChars: 1000,
});

export const fixtureFailure = (error: string): FixtureResult => ({ ok: false, error, logs: [] });
export const isEntry = (value: unknown): value is RunnerEntry => typeof value === 'string' && Object.hasOwn(entryArities, value);
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
export function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

// Copy before stringify so toJSON, accessors, sparse arrays, and coercions never rewrite fixture data.
export function copyJSON(value: unknown): unknown {
  let nodes = 0;
  const ancestors = new Set<object>();
  const copy = (input: unknown, depth: number): unknown => {
    if (++nodes > LIMITS.nodes || depth > LIMITS.depth) throw new Error('JSON data exceeds depth or node limits.');
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'string' && input.length <= LIMITS.idChars) return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (typeof input !== 'object' || input === null) throw new Error('JSON values must be finite numbers, strings of at most 256 characters, booleans, arrays, or records.');
    if (ancestors.has(input)) throw new Error('Input must be JSON-serializable data without cycles.');
    ancestors.add(input);
    const array = Array.isArray(input);
    if (array ? input.length > LIMITS.arrayItems || (Object.getPrototypeOf(input) !== Array.prototype && Object.getPrototypeOf(input) !== null) : !isRecord(input)) throw new Error('Invalid JSON record or array size.');
    const keys = Reflect.ownKeys(input);
    if (array && keys.length !== input.length + 1) throw new Error('JSON arrays must be dense with no extra fields.');
    const output: Record<string, unknown> | unknown[] = array ? Object.setPrototypeOf([], null) : Object.create(null);
    const names = array ? Array.from({ length: input.length }, (_, i) => String(i)) : keys;
    for (const key of names) {
      if (typeof key !== 'string' || key.length > LIMITS.idChars) throw new Error('Invalid JSON key.');
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new Error('JSON fields must be ordinary data, not sparse entries or accessors.');
      Object.defineProperty(output, key, { value: copy(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    ancestors.delete(input);
    return output;
  };
  return copy(value, 0);
}

export function parseArgs(text: unknown, entry: RunnerEntry): unknown[] {
  if (!isEntry(entry)) throw new Error('Unsupported sandbox entrypoint.');
  if (typeof text !== 'string' || text.length > LIMITS.argsChars) throw new Error('Arguments must be JSON data of at most 262,144 characters.');
  const args: unknown = JSON.parse(text);
  copyJSON(args);
  if (!Array.isArray(args) || args.length !== entryArities[entry]) throw new Error('Invalid entrypoint arguments.');
  if (entry === 'route' && (typeof args[1] !== 'string' || typeof args[2] !== 'string')) throw new Error('Start and goal must be string node IDs of at most 256 characters.');
  return args;
}

export function makeBatch(javascript: string, entry: RunnerEntry, fixtures: RunnerFixture[], attempt: number): WireBatch {
  if (!isEntry(entry)) throw new Error('Unsupported sandbox entrypoint.');
  if (typeof javascript !== 'string' || javascript.length > LIMITS.compiledChars) throw new Error('Compiled code exceeds 262,144 characters.');
  if (!Array.isArray(fixtures) || fixtures.length < 1 || fixtures.length > LIMITS.fixtures) throw new Error('Supply between one and eight fixtures.');
  let total = 0;
  const ids = new Set<string>();
  const encoded = fixtures.map((fixture) => {
    if (!isRecord(fixture) || typeof fixture.id !== 'string' || fixture.id.length > LIMITS.idChars || ids.has(fixture.id)) throw new Error('Invalid or duplicate fixture ID.');
    ids.add(fixture.id);
    const argsJSON = JSON.stringify(copyJSON(fixture.args));
    parseArgs(argsJSON, entry);
    total += argsJSON.length;
    if (total > LIMITS.batchArgsChars) throw new Error('Batch arguments exceed their size limit.');
    return { id: fixture.id, argsJSON };
  });
  return { type: 'batch', attempt, entry, javascript, fixtures: encoded };
}

export function validBatch(value: unknown): value is WireBatch {
  if (!isRecord(value) || !exactKeys(value, ['type', 'attempt', 'entry', 'javascript', 'fixtures']) || value.type !== 'batch' ||
      !Number.isSafeInteger(value.attempt) || (value.attempt as number) < 1 || !isEntry(value.entry) ||
      typeof value.javascript !== 'string' || value.javascript.length > LIMITS.compiledChars ||
      !Array.isArray(value.fixtures) || value.fixtures.length < 1 || value.fixtures.length > LIMITS.fixtures) return false;
  let total = 0;
  const ids = new Set<string>();
  for (const fixture of value.fixtures) {
    if (!isRecord(fixture) || !exactKeys(fixture, ['id', 'argsJSON']) || typeof fixture.id !== 'string' ||
        fixture.id.length > LIMITS.idChars || ids.has(fixture.id) || typeof fixture.argsJSON !== 'string' || fixture.argsJSON.length > LIMITS.argsChars) return false;
    ids.add(fixture.id);
    total += fixture.argsJSON.length;
    try { parseArgs(fixture.argsJSON, value.entry); } catch { return false; }
  }
  return total <= LIMITS.batchArgsChars;
}

function validValue(value: unknown, entry: RunnerEntry): boolean {
  if (entry === 'route') return Array.isArray(value) && value.length <= LIMITS.routeNodes && value.every((id) => typeof id === 'string' && id.length <= LIMITS.idChars);
  if (entry !== 'acceptDeliveries') return true;
  if (!isRecord(value) || !exactKeys(value, ['deliveries', 'seen']) || !Array.isArray(value.deliveries) || value.deliveries.length > 100 ||
      !Array.isArray(value.seen) || value.seen.length > 200) return false;
  const id = (input: unknown) => typeof input === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(input);
  return value.seen.every(id) && value.deliveries.every((row) => isRecord(row) && exactKeys(row, ['receiptId', 'item', 'units']) &&
    id(row.receiptId) && id(row.item) && typeof row.units === 'number' && Number.isInteger(row.units) && row.units >= 1 && row.units <= 100);
}

export function parseEnvelope(text: unknown, entry: RunnerEntry): FixtureResult {
  if (!isEntry(entry)) throw new Error('Unsupported sandbox entrypoint.');
  if (typeof text !== 'string' || text.length > LIMITS.envelopeChars) throw new Error('Invalid sandbox response envelope.');
  const result: unknown = JSON.parse(text);
  if (!isRecord(result) || typeof result.ok !== 'boolean' || !exactKeys(result, result.ok ? ['ok', 'value', 'logs'] : ['ok', 'error', 'logs']) ||
      !Array.isArray(result.logs) || result.logs.length > LIMITS.logLines || result.logs.some((line) => typeof line !== 'string' || line.length > LIMITS.logChars)) throw new Error('Invalid sandbox response.');
  if (result.ok) {
    copyJSON(result.value);
    if (!validValue(result.value, entry)) throw new Error('Invalid sandbox result shape.');
    return { ok: true, value: result.value, logs: result.logs as string[] };
  }
  if (typeof result.error !== 'string' || result.error.length > LIMITS.errorChars) throw new Error('Invalid sandbox error.');
  return { ok: false, error: result.error, logs: result.logs as string[] };
}
