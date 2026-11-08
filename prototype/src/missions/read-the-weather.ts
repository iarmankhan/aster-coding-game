import type { ProgramDefinition, ProgramFixture } from '../program-mission-types';

type WeatherCase = Omit<ProgramFixture<'read-the-weather'>, 'args' | 'input'> & { input: { lines: string[] } };
const cases: WeatherCase[] = [
  {
    id: 'arriving-packets', title: 'The observatory packet tray', visibility: 'public',
    detail: 'Trim fields, convert 68 F to 20 C, and reject damaged or out-of-range packets by their original indices.',
    input: { lines: [' soil | 68 | F ', 'roof|21.5|C', 'roof|warm|C', 'soil|90|C', 'soil|0|C|extra'] },
    expected: { readings: [{ sensor: 'soil', celsius: 20 }, { sensor: 'roof', celsius: 21.5 }], rejected: [2, 3, 4] },
  },
  {
    id: 'inclusive-limits', title: 'Both ends of the thermometer', visibility: 'public',
    detail: 'Both Celsius limits are accepted, including their Fahrenheit equivalents. 86 F is 30 C.',
    input: { lines: ['low|-50|C', 'high|80|C', 'low|-58|F', 'high|176|F', 'air|86|F'] },
    expected: { readings: [{ sensor: 'low', celsius: -50 }, { sensor: 'high', celsius: 80 }, { sensor: 'low', celsius: -50 }, { sensor: 'high', celsius: 80 }, { sensor: 'air', celsius: 30 }], rejected: [] },
  },
  {
    id: 'whole-number-field', title: 'Validate the whole packet', visibility: 'public',
    detail: 'Exponents, plus signs, incomplete decimals, missing fields, extra fields, and empty lines fail. Leading zeroes are legal.',
    input: { lines: ['a|1e2|C', 'a|+2|C', 'a|.5|C', 'a|2.|C', 'a||C', 'a|0|C|extra', 'a|0', '', 'a|00.50|C'] },
    expected: { readings: [{ sensor: 'a', celsius: 0.5 }], rejected: [0, 1, 2, 3, 4, 5, 6, 7] },
  },
  {
    id: 'empty-tray', title: 'Empty packet tray', visibility: 'hidden', detail: 'No packets produce two empty arrays.',
    input: { lines: [] }, expected: { readings: [], rejected: [] },
  },
  {
    id: 'renamed-repeated-probes', title: 'Probe names and arrival order', visibility: 'hidden',
    detail: 'Keep repeated readings and a maximum-length sensor ID. Whitespace belongs around fields, not inside them.',
    input: { lines: ['\tprobe-7 | -0.25 | C\t', 'a123456789012345|32|F', 'probe-7|5|C', ' x | 14 | F ', 'probe -7|1|C'] },
    expected: { readings: [{ sensor: 'probe-7', celsius: -0.25 }, { sensor: 'a123456789012345', celsius: 0 }, { sensor: 'probe-7', celsius: 5 }, { sensor: 'x', celsius: -10 }], rejected: [4] },
  },
  {
    id: 'sensor-and-unit-grammar', title: 'Exact sensor and unit grammar', visibility: 'hidden',
    detail: 'Reject uppercase, leading digits, underscores, long names, and nonliteral units without dropping later valid packets.',
    input: { lines: ['Soil|0|C', '1soil|0|C', 'a_b|0|C', 'abcdefghijklmnopq|0|C', 'x|0|c', 'x|0|K', '-|0|C', 'x|0|C'] },
    expected: { readings: [{ sensor: 'x', celsius: 0 }], rejected: [0, 1, 2, 3, 4, 5, 6] },
  },
  {
    id: 'fractional-conversion', title: 'Fractional Fahrenheit and converted limits', visibility: 'hidden',
    detail: 'Do not round fractional conversions. Apply the limits after conversion, including values just outside each end.',
    input: { lines: ['sea|33|F', 'sea|32.9|F', 'sea|-58.01|F', 'sea|176.01|F', 'sea|-50.001|C', 'sea|80.001|C'] },
    expected: { readings: [{ sensor: 'sea', celsius: 0.5555555555555556 }, { sensor: 'sea', celsius: 0.5 }], rejected: [2, 3, 4, 5] },
  },
  {
    id: 'no-coercion-or-prefix-parse', title: 'Numeric text is not JavaScript syntax', visibility: 'hidden',
    detail: 'Reject nondecimal spellings, partial parses, and enormous out-of-range values. Signed zero and decimal zero remain valid.',
    input: { lines: ['p|NaN|C', 'p|Infinity|F', 'p|0x10|C', 'p|20bad|C', 'p|1 2|C', 'p|9999999999999999999999999999999999999999|F', 'p|-0|C', 'p|-00.0|F'] },
    expected: { readings: [{ sensor: 'p', celsius: 0 }, { sensor: 'p', celsius: -17.77777777777778 }], rejected: [0, 1, 2, 3, 4, 5] },
  },
];
const checks = cases.map((check): ProgramFixture<'read-the-weather'> => ({ ...check, args: [check.input.lines] }));
const signature = 'function parseTelemetry(lines: string[]): { readings: { sensor: string; celsius: number }[]; rejected: number[] }';

export const mission: ProgramDefinition<'read-the-weather'> = {
  id: 'read-the-weather',
  brief: {
    title: 'Read the weather',
    lead: 'Help Mara separate useful weather readings from damaged packets.',
    story: 'At the observatory, Mara has a tray of messages from the coastal probes. Some use Fahrenheit, some use Celsius, and some have lost a field in transit. Pip needs a trustworthy reading list before carrying the report to the greenhouse.\n\nYour decoder decides which packets belong on that list. The thermometer playback illustrates the first returned reading list; it is not a physical weather simulation.',
    objective: 'Replace the empty fallback in `parseTelemetry(lines)` with a complete packet decoder.',
    goalSteps: [
      'Split each line into exactly three fields and trim each field.',
      'Validate the sensor, decimal text, unit, and converted temperature.',
      'Return valid readings and rejected source indices in arrival order.',
      'Leave `lines` unchanged, including rejected text.',
    ],
    signature,
    parameters: [{ name: 'lines', type: 'string[]', description: 'A dense array of 0 through 100 strings, each at most 256 characters. A packet is sensor|number|unit. Malformed packet text is allowed and must be rejected, not thrown away silently. Indices start at zero.' }],
    rules: [
      'Split on literal `|`. Accept exactly three fields after trimming each with `trim()`. Empty lines and missing or extra fields are rejected once, at the original line index.',
      'Sensor IDs match `^[a-z][a-z0-9-]{0,15}$`. They have 1 through 16 characters. Lowercase letters, subsequent digits, and hyphens are allowed. Do not lowercase, rename, or deduplicate sensors.',
      'The entire trimmed number field must match `^-?\\d+(?:\\.\\d+)?$`. Leading zeroes and negative zero are allowed. Plus signs, exponents, hexadecimal, incomplete decimals, NaN, Infinity, and suffixes are not. Convert only after validating this grammar, then require a finite number.',
      'Units must be exactly `C` or `F`. For F use `(value - 32) * 5 / 9`. For C keep the value. Accept only finite converted Celsius in the inclusive range -50 through 80. Do not round. Only `celsius` comparisons allow absolute error at most 1e-9.',
      'Return exactly `{ readings, rejected }`. Each reading has exactly `{ sensor, celsius }`. Preserve valid-reading order and rejected-index order separately. Repeated sensor IDs produce repeated readings. Array order matters; object key order does not. Rejected indices are exact integers, with no numeric tolerance.',
      'Treat every input as readonly. Do not mutate arrays or depend on earlier calls. Inputs and outputs are dense finite JSON. Each argument tuple and returned value must stay within 4096 JSON nodes, depth 16, 200 entries per array, and 256 characters per string. This mission returns at most 100 readings and 100 rejected indices.',
      'Run examples runs these 3 public cases. Submit solution runs all 8 cases, including 5 hidden cases. Progress requires all 8 to pass, unchanged submitted source, and completed playback of the actual first public result. Examples alone, stopped playback, or edits do not earn progress. Hidden details are redacted from normal results, not cryptographically secret from a local browser owner.',
    ],
    examples: checks.filter((check) => check.visibility === 'public').map((check) => ({ title: check.title, input: JSON.stringify(check.input, null, 2), output: JSON.stringify(check.expected, null, 2), explanation: check.detail })),
  },
  starter: `${signature} {
  // TODO: Decode valid packets and report rejected source indices.
  return { readings: [], rejected: [] };
}`,
  solution: `${signature} {
  const readings: { sensor: string; celsius: number }[] = [];
  const rejected: number[] = [];
  for (let index = 0; index < lines.length; index++) {
    const fields = lines[index].split('|').map((field) => field.trim());
    const [sensor, text, unit] = fields;
    if (fields.length !== 3 || !/^[a-z][a-z0-9-]{0,15}$/.test(sensor) ||
        !/^-?\\d+(?:\\.\\d+)?$/.test(text) || (unit !== 'C' && unit !== 'F')) {
      rejected.push(index);
      continue;
    }
    const value = Number(text);
    const celsius = unit === 'F' ? (value - 32) * 5 / 9 : value;
    if (!Number.isFinite(value) || !Number.isFinite(celsius) || celsius < -50 || celsius > 80) rejected.push(index);
    else readings.push({ sensor, celsius });
  }
  return { readings, rejected };
}`,
  hints: [
    'A packet can contain a plausible number and still be invalid. Which checks must happen before Number is called?',
    'Keep the original loop index for rejected packets. Validate whole fields, then convert Fahrenheit before testing the inclusive Celsius limits.',
    'Build two arrays. For each line, split and trim, test field count and both regexes and unit, then compute Celsius. Push either one rejected index or one { sensor, celsius } reading. Never round or deduplicate.',
  ],
  checks,
};
