import assert from 'node:assert/strict';
import { escapeHTML, formatInline, formatParagraphs, formatCode } from '../src/brief-format';
import { clampBriefWidth, parseBriefFraction } from '../src/brief-resize';
import { firstMission } from '../src/curriculum';
import { deliveryMission } from '../src/delivery-mission';

assert.equal(escapeHTML('<>&"\''), '&lt;&gt;&amp;&quot;&#39;');
assert.equal(formatInline('Use `graph["dock"]` & `[]`.'), 'Use <code>graph[&quot;dock&quot;]</code> &amp; <code>[]</code>.');
assert.equal(formatInline('<img onerror="alert(1)"> `</code><script>&`'), '&lt;img onerror=&quot;alert(1)&quot;&gt; <code>&lt;/code&gt;&lt;script&gt;&amp;</code>');
assert.equal(formatInline('unmatched `tick <&'), 'unmatched `tick &lt;&amp;');
assert.equal(formatInline('literal `` and [link](javascript:alert(1)) **bold**'), 'literal `` and [link](javascript:alert(1)) **bold**');
assert.equal(formatInline('a `line\nbreak` b'), 'a `line\nbreak` b');
assert.equal(formatParagraphs('One `ID`.\n\nTwo <safe>.\r\n\r\nThree.'), '<p>One <code>ID</code>.</p><p>Two &lt;safe&gt;.</p><p>Three.</p>');
const literalCode = '  const x = `<script>&"`;\n    return x < 2;';
assert.equal(formatCode(literalCode), `<pre tabindex="0" aria-label="Code sample"><code>${escapeHTML(literalCode)}</code></pre>`);
assert(!formatCode(literalCode).includes('<script>'));
assert(!formatCode(literalCode).includes('<code><code>'));
for (const raw of [null, '', 'null', 'false', '"0.4"', '{}', '[]', 'NaN', 'Infinity', '1e309', '-0.2', '0', '1.1']) assert.equal(parseBriefFraction(raw), null, String(raw));
for (const fraction of [.01, .28, .5, .8, 1]) assert.equal(parseBriefFraction(String(fraction)), fraction);
assert.equal(clampBriefWidth(100, 1440), 310);
assert.equal(clampBriefWidth(1000, 1440), 720);
assert.equal(clampBriefWidth(400, 1000), 400);
assert.equal(clampBriefWidth(400, 500), 250);
for (const brief of [firstMission, deliveryMission.brief]) {
  assert.equal(brief.goalSteps.length, 4, `${brief.title} has four short task rules`);
  assert.equal(brief.objective.split('\n').length, 1, 'goal intro stays short');
  assert(brief.objective.includes('fallback'));
  assert(brief.signature.split('\n').length >= 5, 'display contract is intentionally formatted across lines');
  assert(brief.signature.split('\n').every((line) => line.length <= 40), 'display contract fits narrow reading panes without hiding the return type');
  assert(formatParagraphs(brief.story).includes('</p><p>'), 'story has separate paragraphs');
  assert(brief.examples.every((example) => JSON.parse(example.input) && JSON.parse(example.output)));
}
assert.equal(deliveryMission.brief.rules.length, 7, 'all seven delivery criteria remain visible');
console.log('PASS brief helper escaping, literal code, paragraphs, preference validation, and workspace bounds.');
