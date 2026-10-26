/**
 * Builds a small valid one-page PDF with the given lines of ASCII text (Helvetica), with a
 * correct xref table so any reader (pdf.js included) extracts the text. Test fixture only.
 */
function makePdf(lines) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const text = lines.map((l, i) => `BT /F1 11 Tf 40 ${780 - i * 16} Td (${esc(l)}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const SAMPLE_CV = [
  'Khaled Salem - Data Analyst',
  'Experience: Data Analyst, Riyadh Analytics Co., 2022 - present.',
  'Assistant analyst, Gulf Retail Group, 2019 - 2022.',
  'Skills: SQL, Power BI, Excel, Python (pandas), reporting, dashboards.',
  'Education: BSc Information Systems, King Saud University, 2018.',
];

module.exports = { makePdf, SAMPLE_CV };
