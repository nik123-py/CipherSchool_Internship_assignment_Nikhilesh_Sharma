import { marked } from 'marked';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(PROJECT, 'submission');
mkdirSync(OUT, { recursive: true });

/** Chrome is used purely as a PDF renderer; any of these installs will do. */
const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => p && existsSync(p));

if (!CHROME) {
  console.error('No Chrome/Edge found. Set CHROME_PATH to a Chromium binary and retry.');
  process.exit(1);
}

const CSS = `
  @page { size: A4; margin: 16mm 15mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", -apple-system, system-ui, sans-serif;
    font-size: 10.2pt; line-height: 1.5; color: #1a1a1a;
    margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  h1 { font-size: 19pt; margin: 0 0 2mm; letter-spacing: -0.2pt; line-height: 1.2; }
  h1 + p { color: #555; font-size: 10.5pt; margin-top: 0; }
  h2 {
    font-size: 13pt; margin: 7mm 0 2.5mm; padding-bottom: 1.2mm;
    border-bottom: 1.6px solid #2b2b2b; letter-spacing: -0.1pt;
    break-after: avoid; page-break-after: avoid;
  }
  h3 { font-size: 11pt; margin: 5mm 0 1.5mm; break-after: avoid; page-break-after: avoid; }
  p, li { orphans: 3; widows: 3; }
  p { margin: 0 0 2.5mm; }
  ul, ol { margin: 0 0 2.5mm; padding-left: 5.5mm; }
  li { margin-bottom: 1mm; }
  li > strong:first-child { color: #000; }
  code {
    font-family: Consolas, "Cascadia Mono", monospace; font-size: 8.8pt;
    background: #f2f2f4; padding: 0.4mm 1.1mm; border-radius: 2px; color: #1a1a1a;
  }
  pre {
    background: #f7f7f9; border: 1px solid #e0e0e4; border-left: 2.5px solid #888;
    padding: 2.5mm 3mm; border-radius: 3px; font-size: 8.4pt; line-height: 1.42;
    overflow: visible; white-space: pre-wrap; word-wrap: break-word;
    break-inside: avoid; page-break-inside: avoid; margin: 0 0 3mm;
  }
  pre code { background: none; padding: 0; font-size: inherit; }
  table {
    border-collapse: collapse; width: 100%; margin: 0 0 3.5mm; font-size: 9.1pt;
    break-inside: avoid; page-break-inside: avoid;
  }
  th {
    background: #ececf0; text-align: left; font-weight: 600;
    padding: 1.6mm 2.2mm; border: 1px solid #ccccd2;
  }
  td { padding: 1.5mm 2.2mm; border: 1px solid #d8d8de; vertical-align: top; }
  tr:nth-child(even) td { background: #fafafb; }
  blockquote {
    margin: 0 0 3mm; padding: 2mm 3mm; background: #fff8e6;
    border-left: 2.5px solid #d9a441; color: #4a3a10; font-size: 9.3pt;
  }
  blockquote p { margin: 0 0 1.5mm; }
  blockquote p:last-child { margin: 0; }
  hr { border: none; border-top: 1px solid #d5d5da; margin: 5mm 0; }
  a { color: #1a1a1a; text-decoration: none; }
  strong { font-weight: 600; }
  .footer {
    margin-top: 7mm; padding-top: 2mm; border-top: 1px solid #d5d5da;
    font-size: 8.2pt; color: #777; display: flex; justify-content: space-between;
  }
`;

function render(title, markdown, footer) {
  // Strip the instruction blockquotes addressed to the author, not the reader.
  const cleaned = markdown
    .replace(/^> \*\*(Before submitting|TO COMPLETE BEFORE SUBMITTING):.*?(?=\n\n|$)/gms, '')
    .replace(/\n{3,}/g, '\n\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>${CSS}</style></head><body>
${marked.parse(cleaned)}
<div class="footer"><span>${footer}</span><span>nik488151@gmail.com</span></div>
</body></html>`;
}

function toPdf(name, html) {
  const htmlPath = join(OUT, `${name}.html`);
  const pdfPath = join(OUT, `${name}.pdf`);
  writeFileSync(htmlPath, html, 'utf8');
  execFileSync(CHROME, [
    '--headless', '--disable-gpu', '--no-pdf-header-footer',
    `--print-to-pdf=${pdfPath}`, `file:///${htmlPath.replace(/\\/g, '/')}`,
  ], { stdio: 'pipe' });
  return pdfPath;
}

const read = (p) => readFileSync(join(PROJECT, p), 'utf8');
const built = [];

built.push(toPdf('Research-Note', render(
  'Research Note — LLD Practice Platform', read('docs/RESEARCH.md'), 'Research Note — LLD Practice Platform')));

built.push(toPdf('Design-Note', render(
  'Design Note — LLD Practice Platform', read('docs/DESIGN.md'), 'Design Note — LLD Practice Platform')));

// The form takes ONE file for README + AI_USAGE, so they are combined.
const combined = read('README.md') + '\n\n<div style="break-before:page"></div>\n\n' + read('AI_USAGE.md');
built.push(toPdf('README-and-AI-Usage', render(
  'README & AI Usage — LLD Practice Platform', combined, 'README & AI Usage Report — LLD Practice Platform')));

console.log(built.join('\n'));
