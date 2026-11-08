import type { QuickJSContext, QuickJSHandle, QuickJSRuntime, QuickJSWASMModule, VmCallResult } from 'quickjs-emscripten';
import { LIMITS, entryArities, fixtureFailure, isEntry, parseArgs, parseEnvelope } from './runner-protocol';
import type { FixtureResult, RunnerEntry } from './runner-protocol';

// All callbacks and JSON operations stay inside QuickJS. Capture before guest code can replace intrinsics.
const bootstrap = `(() => {
  const isArray = Array.isArray, stringify = JSON.stringify, parse = JSON.parse;
  const create = Object.create, proto = Object.getPrototypeOf, setProto = Object.setPrototypeOf;
  const ownKeys = Reflect.ownKeys, descriptor = Object.getOwnPropertyDescriptor;
  const own = Function.prototype.call.bind(Object.prototype.hasOwnProperty);
  const freeze = Object.freeze, define = Object.defineProperty, finite = Number.isFinite;
  const objectProto = Object.prototype, arrayProto = Array.prototype;
  const slice = Function.prototype.call.bind(String.prototype.slice), string = String;
  const NativeError = Error, NativeProxy = Proxy;
  const errorProtos = setProto([Error.prototype, TypeError.prototype, RangeError.prototype,
    ReferenceError.prototype, SyntaxError.prototype, URIError.prototype, EvalError.prototype], null);
  const errorNames = setProto(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError'], null);
  const logs = setProto([], null);
  let mutated = false;
  const deny = () => { mutated = true; throw new NativeError('Inputs are read-only. Do not mutate input arrays or rows.'); };
  const handler = freeze(Object.assign(create(null), {
    set: deny, deleteProperty: deny, defineProperty: deny, setPrototypeOf: deny, preventExtensions: deny
  }));
  const readonly = (value) => {
    if (value === null || typeof value !== 'object') return value;
    const keys = ownKeys(value);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (!isArray(value) || key !== 'length') define(value, key, { value: readonly(value[key]), enumerable: true, writable: true, configurable: true });
    }
    return new NativeProxy(freeze(value), handler);
  };
  const truncated = '[Truncated]';
  const shorten = (text, limit) => text.length > limit ? slice(text, 0, limit - truncated.length) + truncated : text;
  const put = (output, key, value) => {
    const field = create(null);
    field.value = value; field.enumerable = true; field.configurable = true;
    define(output, key, field);
  };
  const stringifyLog = (value) => {
    // QuickJS stringify uses prototype-sensitive numeric writes in its internal array stack.
    if (proto(arrayProto) !== objectProto || proto(objectProto) !== null) return '[Uninspectable]';
    for (let p = 0; p < 2; p++) {
      const keys = ownKeys(p ? objectProto : arrayProto);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (typeof key === 'string' && key !== '' && +key >= 0 && +key < 4294967295 && string(+key) === key) {
          return '[Uninspectable]';
        }
      }
    }
    return stringify(value);
  };
  const log = function() {
    if (logs.length >= ${LIMITS.logLines}) return;
    const values = arguments;
    let nodes = 0;
    const ancestors = setProto([], null);
    const snapshot = (input, depth) => {
      if (nodes >= 100 || logs.length >= ${LIMITS.logLines}) return truncated;
      nodes++;
      const kind = typeof input;
      if (input === null || kind === 'boolean') return input;
      if (kind === 'string') return shorten(input, depth ? 200 : ${LIMITS.logChars});
      if (kind === 'number') return finite(input) ? input : '[' + string(input) + ']';
      if (kind === 'undefined') return '[Undefined]';
      if (kind === 'function') return '[Function]';
      if (kind === 'bigint') return shorten(string(input), 199) + 'n';
      if (kind === 'symbol') return shorten(string(input), 200);
      for (let i = 0; i < ancestors.length; i++) if (ancestors[i] === input) return '[Circular]';
      if (depth >= 4) return truncated;
      ancestors[ancestors.length] = input;
      try {
        const array = isArray(input), prototype = proto(input);
        if (logs.length >= ${LIMITS.logLines}) return truncated;
        if (!array && prototype !== null && prototype !== objectProto) {
          for (let i = 0; i < errorProtos.length; i++) if (prototype === errorProtos[i]) {
            const output = create(null);
            let j = 0;
            for (; j < 2 && nodes < 100 && logs.length < ${LIMITS.logLines}; j++) {
              const key = j ? 'message' : 'name', field = descriptor(input, key);
              put(output, key, snapshot(!field ? (j ? '' : errorNames[i]) :
                own(field, 'value') ? field.value : '[Accessor]', depth + 1));
            }
            if (j < 2) put(output, truncated, truncated);
            return output;
          }
          return '[Object]';
        }
        const keys = ownKeys(input), output = array ? setProto([], null) : create(null);
        if (logs.length >= ${LIMITS.logLines}) return truncated;
        const lengthField = array ? descriptor(input, 'length') : null;
        const length = array ? (lengthField && own(lengthField, 'value') ? lengthField.value : 0) : keys.length;
        if (array && (typeof length !== 'number' || !finite(length) || length < 0 || length % 1)) return '[Uninspectable]';
        const count = length < 20 ? length : 20;
        let i = 0;
        for (; i < count && nodes < 100 && logs.length < ${LIMITS.logLines}; i++) {
          const key = array ? string(i) : keys[i], field = descriptor(input, key);
          const value = snapshot(!field ? '[Empty]' : own(field, 'value') ? field.value : '[Accessor]', depth + 1);
          put(output, array ? key : shorten(string(key), 80), value);
        }
        if (i < length || (array && keys.length > length + 1)) put(output, array ? string(i) : truncated, truncated);
        return output;
      } catch (_) {
        return '[Uninspectable]';
      } finally {
        ancestors.length--;
      }
    };
    let line = '';
    for (let i = 0; i < values.length && logs.length < ${LIMITS.logLines}; i++) {
      const value = snapshot(values[i], 0);
      if (logs.length >= ${LIMITS.logLines}) return;
      const text = line + (i ? ' ' : '') + (value !== null && typeof value === 'object' ? stringifyLog(value) : string(value));
      const more = i + 1 < values.length;
      if (text.length > ${LIMITS.logChars} || stringify(text).length > 4000 ||
          (more && (nodes >= 100 || text.length === ${LIMITS.logChars} || stringify(text).length === 4000))) {
        let low = 0, high = text.length < ${LIMITS.logChars} - truncated.length ? text.length : ${LIMITS.logChars} - truncated.length;
        while (low < high) {
          const middle = (low + high + 1) >>> 1;
          if (stringify(slice(text, 0, middle) + truncated).length <= 4000) low = middle;
          else high = middle - 1;
        }
        line = slice(text, 0, low) + truncated;
        break;
      }
      line = text;
    }
    if (logs.length < ${LIMITS.logLines}) logs[logs.length] = line;
  };
  const console = create(null);
  console.log = console.info = console.warn = console.error = console.debug = log;
  globalThis.console = freeze(console);
  const encode = (ok, value) => {
    const result = create(null);
    result.ok = ok;
    result.logs = logs;
    if (ok) result.value = value; else result.error = value;
    const text = stringify(result);
    if (text.length > ${LIMITS.envelopeChars}) throw new NativeError('Sandbox output exceeds 262,144 characters.');
    return text;
  };
  const copy = (value) => {
    let nodes = 0, chars = 64;
    for (let i = 0; i < logs.length; i++) chars += stringify(logs[i]).length + 1;
    const ancestors = setProto([], null);
    const add = (count) => { chars += count; if (chars > ${LIMITS.envelopeChars}) throw new NativeError('Sandbox output exceeds 262,144 characters.'); };
    const visit = (input, depth) => {
      if (++nodes > ${LIMITS.nodes} || depth > ${LIMITS.depth}) throw new NativeError('JSON output exceeds depth or node limits.');
      if (input === null || typeof input === 'boolean') { add(5); return input; }
      if (typeof input === 'number' && finite(input)) { add(32); return input; }
      if (typeof input === 'string') {
        if (input.length > ${LIMITS.idChars}) throw new NativeError('JSON strings must have at most 256 characters.');
        add(stringify(input).length); return input;
      }
      if (typeof input !== 'object' || input === null) throw new NativeError('Return finite JSON values, not undefined, functions, bigint, or non-finite numbers.');
      for (let i = 0; i < ancestors.length; i++) if (ancestors[i] === input) throw new NativeError('Cyclic JSON output is not allowed.');
      ancestors[ancestors.length] = input;
      const array = isArray(input), prototype = proto(input);
      if (prototype !== null && prototype !== (array ? arrayProto : objectProto)) throw new NativeError('Return ordinary JSON records and arrays.');
      const keys = ownKeys(input);
      const length = array ? input.length : keys.length;
      if (array && (typeof length !== 'number' || length < 0 || length > ${LIMITS.arrayItems} || length % 1 || keys.length !== length + 1)) throw new NativeError('Return dense JSON arrays with at most 200 items and no extra fields.');
      const output = array ? setProto([], null) : create(null);
      add(2 + length);
      for (let i = 0; i < length; i++) {
        const key = array ? string(i) : keys[i];
        if (typeof key !== 'string' || key.length > ${LIMITS.idChars} || !own(input, key)) throw new NativeError('Return dense JSON arrays and string-keyed records.');
        if (!descriptor(input, key).enumerable) throw new NativeError('JSON fields must be enumerable.');
        if (!array) add(stringify(key).length + 1);
        define(output, key, { value: visit(input[key], depth + 1), enumerable: true, writable: true, configurable: true });
      }
      ancestors.length--;
      return output;
    };
    return visit(value, 0);
  };
  const checkMutation = () => { if (mutated) throw new NativeError('Inputs are read-only. Do not mutate input arrays or rows.'); };
  const id = (value) => {
    if (typeof value !== 'string' || value.length < 1 || value.length > 32) return false;
    for (let i = 0; i < value.length; i++) {
      const c = value[i];
      if (!(c >= 'a' && c <= 'z') && !(i > 0 && ((c >= '0' && c <= '9') || c === '-'))) return false;
    }
    return true;
  };
  const fields = (value, expected) => {
    if (!value || typeof value !== 'object' || isArray(value)) return false;
    const keys = ownKeys(value);
    if (keys.length !== expected.length) return false;
    for (let i = 0; i < expected.length; i++) if (!own(value, expected[i])) return false;
    return true;
  };
  const helpers = create(null);
  helpers.inputs = (text) => readonly(parse(text));
  helpers.program = (value) => {
    checkMutation();
    const result = copy(value);
    checkMutation();
    return encode(true, result);
  };
  helpers.route = (value) => {
    checkMutation();
    if (!isArray(value)) throw new NativeError('route() must return an array of string node IDs.');
    if (value.length > ${LIMITS.routeNodes}) throw new NativeError('route() must return at most 100 nodes.');
    const result = copy(value);
    for (let i = 0; i < result.length; i++) if (typeof result[i] !== 'string') throw new NativeError('Each route node must be a string of at most 256 characters.');
    checkMutation();
    return encode(true, result);
  };
  helpers.acceptDeliveries = (value) => {
    checkMutation();
    const result = copy(value);
    if (!fields(result, ['deliveries', 'seen']) || !isArray(result.deliveries) || result.deliveries.length > 100 || !isArray(result.seen) || result.seen.length > 200) throw new NativeError('Return exactly { deliveries, seen }, with at most 100 delivery rows and 200 seen IDs.');
    for (let i = 0; i < result.deliveries.length; i++) {
      const row = result.deliveries[i];
      if (!fields(row, ['receiptId', 'item', 'units']) || !id(row.receiptId) || !id(row.item) || typeof row.units !== 'number' || !finite(row.units) || row.units % 1 || row.units < 1 || row.units > 100) throw new NativeError('Delivery rows require exactly receiptId, item, and integer units from 1 through 100, with valid lowercase IDs.');
    }
    for (let i = 0; i < result.seen.length; i++) if (!id(result.seen[i])) throw new NativeError('seen must contain valid lowercase receipt IDs.');
    checkMutation();
    return encode(true, result);
  };
  helpers.error = (value) => {
    let text = 'Code threw an error.';
    try {
      if (mutated) text = 'Inputs are read-only. Do not mutate input arrays or rows.';
      else if (typeof value === 'string') text = value;
      else if (value && typeof value.message === 'string') text = (typeof value.name === 'string' ? value.name + ': ' : '') + value.message;
    } catch (_) {}
    return encode(false, slice(text, 0, ${LIMITS.errorChars}) || 'Code threw an error.');
  };
  return helpers;
})()`;

export function executeJavaScript(
  engine: QuickJSWASMModule, javascript: string, entry: RunnerEntry, argsJSON: string,
): FixtureResult {
  if (!isEntry(entry)) return fixtureFailure('Unsupported sandbox entrypoint.');
  if (typeof javascript !== 'string' || javascript.length > LIMITS.compiledChars) return fixtureFailure('Compiled code exceeds 262,144 characters.');
  try { parseArgs(argsJSON, entry); } catch (error) { return fixtureFailure(error instanceof Error ? error.message : 'Invalid arguments.'); }
  let runtime: QuickJSRuntime | undefined;
  let context: QuickJSContext | undefined;
  let timedOut = false;
  const handles: QuickJSHandle[] = [];
  const keep = (handle: QuickJSHandle) => { handles.push(handle); return handle; };
  try {
    runtime = engine.newRuntime();
    runtime.setMemoryLimit(LIMITS.memoryBytes);
    runtime.setMaxStackSize(LIMITS.stackBytes);
    const deadline = performance.now() + LIMITS.runtimeMs;
    runtime.setInterruptHandler(() => { timedOut ||= performance.now() >= deadline; return timedOut; });
    const vm = context = runtime.newContext();
    const helpers = keep(vm.unwrapResult(vm.evalCode(bootstrap, 'runner-bootstrap.js')));
    const encodeValue = keep(vm.getProp(helpers, entry === 'route' || entry === 'acceptDeliveries' ? entry : 'program'));
    const encodeError = keep(vm.getProp(helpers, 'error'));
    const parseInputs = keep(vm.getProp(helpers, 'inputs'));
    const text = keep(vm.newString(argsJSON));
    const args = keep(vm.unwrapResult(vm.callFunction(parseInputs, vm.undefined, text)));
    const inputHandles = Array.from({ length: entryArities[entry] }, (_, index) => keep(vm.getProp(args, index)));
    const read = (result: VmCallResult<QuickJSHandle>): FixtureResult => {
      if (result.error) {
        keep(result.error);
        return fixtureFailure(timedOut ? 'Execution exceeded the 400 ms runtime limit.' : 'Could not serialize the sandbox result within its resource limits.');
      }
      const encoded = keep(result.value);
      if (vm.typeof(encoded) !== 'string') throw new Error('Invalid sandbox response.');
      return parseEnvelope(vm.getString(encoded), entry);
    };
    const userError = (handle: QuickJSHandle): FixtureResult => {
      keep(handle);
      return timedOut ? fixtureFailure('Execution exceeded the 400 ms runtime limit.') : read(vm.callFunction(encodeError, vm.undefined, handle));
    };
    const loaded = vm.evalCode('"use strict";\n' + javascript, 'player-code.js', { type: 'global' });
    if (loaded.error) return userError(loaded.error);
    keep(loaded.value);
    const found = vm.evalCode(`typeof ${entry} === "function" ? ${entry} : undefined`, 'runner-entry.js');
    if (found.error) return userError(found.error);
    const fn = keep(found.value);
    if (vm.typeof(fn) !== 'function') return userError(vm.newString(`Define function ${entry} with ${entryArities[entry]} arguments.`));
    const called = vm.callFunction(fn, vm.undefined, ...inputHandles);
    if (called.error) return userError(called.error);
    const output = keep(called.value);
    const encoded = vm.callFunction(encodeValue, vm.undefined, output);
    if (encoded.error) return userError(encoded.error);
    return read(encoded);
  } catch {
    return fixtureFailure(timedOut ? 'Execution exceeded the 400 ms runtime limit.' : 'Execution failed. The sandbox may have reached its memory or stack limit.');
  } finally {
    try {
      for (let i = handles.length - 1; i >= 0; i--) handles[i].dispose();
      context?.dispose();
      runtime?.dispose();
    } catch {
      // A trapped WASM instance can refuse disposal. Its attempt worker is always terminated.
    }
  }
}
