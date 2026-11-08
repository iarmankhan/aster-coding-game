import ts from 'typescript';
import { getQuickJS } from 'quickjs-emscripten';
import { executeJavaScript } from '../src/runner-core';
import { LIMITS, fixtureFailure, makeBatch } from '../src/runner-protocol';
import type { FixtureResult, RunnerEntry } from '../src/runner-protocol';
export { LIMITS } from '../src/runner-protocol';

export type RunnerResult =
  | { ok: true; route: string[]; logs: string[] }
  | { ok: false; error: string; logs: string[] };

// Trusted Node test fixtures only. Browser execution never imports this syntax-only adapter.
export function compileTestSource(source: string): { ok: true; javascript: string } | { ok: false; error: string } {
  if (typeof source !== 'string' || source.length > LIMITS.sourceChars) return { ok: false, error: 'Code must be a string of at most 65,536 characters.' };
  const output = ts.transpileModule(source, {
    fileName: 'player-code.ts', reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, strict: true },
  });
  const errors = output.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error) ?? [];
  if (errors.length) return { ok: false, error: errors.slice(0, 3).map((item) => {
    const position = item.file?.getLineAndCharacterOfPosition(item.start ?? 0);
    return `TypeScript TS${item.code}${position ? ` (${position.line + 1}:${position.character + 1})` : ''}: ${ts.flattenDiagnosticMessageText(item.messageText, ' ')}`;
  }).join('\n').slice(0, LIMITS.errorChars) };
  if (output.outputText.length > LIMITS.compiledChars) return { ok: false, error: 'Compiled code exceeds 262,144 characters. Simplify your TypeScript.' };
  return { ok: true, javascript: output.outputText };
}

export async function executeTestSource(source: string, entry: RunnerEntry, args: unknown[]): Promise<FixtureResult> {
  const compiled = compileTestSource(source);
  if (!compiled.ok) return fixtureFailure(compiled.error);
  try {
    const request = makeBatch(compiled.javascript, entry, [{ id: 'node-test', args }], 1);
    return executeJavaScript(await getQuickJS(), request.javascript, request.entry, request.fixtures[0].argsJSON);
  } catch (error) { return fixtureFailure(error instanceof Error ? error.message : 'Invalid JSON-serializable input.'); }
}

export async function executeInQuickJS(source: string, graph: unknown, start: string, goal: string): Promise<RunnerResult> {
  const result = await executeTestSource(source, 'route', [graph, start, goal]);
  return result.ok ? { ok: true, route: result.value as string[], logs: result.logs } : result;
}
