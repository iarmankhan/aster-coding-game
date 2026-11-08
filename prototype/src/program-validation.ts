import type { ProgramMissionId } from './mission-catalog';
import { copyJSON } from './runner-protocol';

export function validateProgram(mission: ProgramMissionId, actual: unknown, expected: unknown): string | null {
  let value: unknown;
  try { value = copyJSON(actual); } catch (error) {
    return `result must be bounded ordinary finite JSON. ${error instanceof Error ? error.message : 'Invalid result.'}`;
  }
  const compare = (received: unknown, wanted: unknown, path: string): string | null => {
    if (typeof wanted === 'number') {
      const tolerant = mission === 'read-the-weather' && /^result\.readings\[\d+\]\.celsius$/.test(path) ||
        mission === 'steady-the-sensors' && /^result\[\d+\]\.mean$/.test(path);
      return typeof received === 'number' && Number.isFinite(received) &&
        (received === wanted || tolerant && Math.abs(received - wanted) <= 1e-9) ? null : `${path} must equal ${wanted}.`;
    }
    if (wanted === null || typeof wanted !== 'object') return received === wanted ? null : `${path} must equal ${JSON.stringify(wanted)}.`;
    if (Array.isArray(wanted)) {
      if (!Array.isArray(received) || received.length !== wanted.length) return `${path} must be an array of exactly ${wanted.length} items in the stated order.`;
      for (let i = 0; i < wanted.length; i++) {
        const error = compare(received[i], wanted[i], `${path}[${i}]`);
        if (error) return error;
      }
      return null;
    }
    if (received === null || typeof received !== 'object' || Array.isArray(received)) return `${path} must be a record.`;
    const keys = Object.keys(wanted);
    if (Object.keys(received).length !== keys.length || keys.some((key) => !Object.hasOwn(received, key))) return `${path} must contain exactly ${keys.join(', ')}.`;
    for (const key of keys) {
      const error = compare((received as Record<string, unknown>)[key], (wanted as Record<string, unknown>)[key], `${path}.${key}`);
      if (error) return error;
    }
    return null;
  };
  return compare(value, expected, 'result');
}
