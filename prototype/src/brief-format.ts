export const escapeHTML = (value: string): string => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

export function formatInline(value: string): string {
  let result = '';
  let start = 0;
  for (const match of value.matchAll(/`([^`\r\n]+)`/g)) {
    result += escapeHTML(value.slice(start, match.index)) + `<code>${escapeHTML(match[1])}</code>`;
    start = match.index + match[0].length;
  }
  return result + escapeHTML(value.slice(start));
}

export const formatParagraphs = (value: string): string => value.trim().split(/\r?\n\s*\r?\n/).map((paragraph) => `<p>${formatInline(paragraph)}</p>`).join('');
export const formatCode = (value: string): string => `<pre tabindex="0" aria-label="Code sample"><code>${escapeHTML(value)}</code></pre>`;
