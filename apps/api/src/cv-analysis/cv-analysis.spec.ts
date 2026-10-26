import Anthropic from '@anthropic-ai/sdk';
import { UnrecoverableError } from 'bullmq';
import { createFakePrisma } from '../testing/fake-prisma';
import { AnthropicCvAnalyzer, classify } from './anthropic-cv-analyzer';
import { CvAnalysisError, CvAnalyzer, validateResult } from './cv-analyzer';
import { CvAnalysisProcessor } from './cv-analysis.processor';
import { CvTextError, extractCvText } from './cv-text';

// pdf.js needs ESM dynamic imports that Jest's CommonJS sandbox cannot run, so the processor
// tests stub text extraction; real PDF/DOCX extraction is tested in test/node/cv-text.test.ts.
jest.mock('./cv-text', () => {
  const actual = jest.requireActual('./cv-text');
  return { ...actual, extractCvText: jest.fn() };
});
const extract = extractCvText as jest.MockedFunction<typeof extractCvText>;
const CV_TEXT = 'Khaled Salem - Data Analyst. Skills: SQL, Power BI.';

const SECTORS = [
  { code: 'IT', nameEn: 'ICT', nameAr: 'تقنية' },
  { code: 'FINANCE', nameEn: 'Finance', nameAr: 'مالية' },
];
const GOOD = {
  sectorCode: 'IT',
  skills: ['SQL', 'Power BI', 'sql', ' Python '],
  inferredYears: 6,
  tipsAr: ['نصيحة أولى مفيدة', 'نصيحة ثانية مفيدة', 'نصيحة ثالثة مفيدة'],
  tipsEn: ['First useful tip', 'Second useful tip', 'Third useful tip'],
};

function mockClient(response: Partial<Record<string, unknown>> | Error) {
  const parse = jest.fn(async () => {
    if (response instanceof Error) throw response;
    return { model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 }, ...response };
  });
  return { client: { beta: { messages: { parse } } } as any, parse };
}

describe('AnthropicCvAnalyzer (mocked client, no network)', () => {
  it('sends only the CV text and the sector list, with structured output and fallback', async () => {
    const { client, parse } = mockClient({ parsed_output: GOOD });
    const analyzer = new AnthropicCvAnalyzer(client, { model: 'claude-opus-5-5', fallback: true });
    const out = await analyzer.analyze({ text: 'CV TEXT ONLY', sectors: SECTORS });
    expect(out).toEqual({
      result: { ...GOOD, skills: ['SQL', 'Power BI', 'Python'] },
      model: 'claude-opus-5-5',
      inputTokens: 10,
      outputTokens: 5,
    });
    const req = (parse.mock.calls[0] as any[])[0];
    expect(req.model).toBe('claude-opus-5-5');
    expect(req.fallbacks).toBe('default');
    expect(req.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(req.output_config.format.type).toBe('json_schema');
    expect(req.messages).toHaveLength(1);
    const content = req.messages[0].content as string;
    expect(content).toContain('<cv>\nCV TEXT ONLY\n</cv>');
    expect(content).toContain('IT: ICT / تقنية');
  });

  it('omits the fallback parameters when disabled', async () => {
    const { client, parse } = mockClient({ parsed_output: GOOD });
    await new AnthropicCvAnalyzer(client, { model: 'm', fallback: false }).analyze({ text: 't', sectors: SECTORS });
    const req = (parse.mock.calls[0] as any[])[0];
    expect(req.fallbacks).toBeUndefined();
    expect(req.betas).toBeUndefined();
  });

  it('maps refusals, truncation and invalid output', async () => {
    const run = (r: Record<string, unknown>) =>
      new AnthropicCvAnalyzer(mockClient(r).client, { model: 'm', fallback: true }).analyze({ text: 't', sectors: SECTORS });
    await expect(run({ stop_reason: 'refusal', parsed_output: null })).rejects.toMatchObject({ code: 'REFUSED', retryable: false });
    await expect(run({ stop_reason: 'max_tokens', parsed_output: null })).rejects.toMatchObject({ code: 'MAX_TOKENS', retryable: true });
    await expect(run({ parsed_output: { ...GOOD, tipsEn: ['only one'] } })).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
    await expect(run({ parsed_output: { ...GOOD, sectorCode: 'NOPE' } })).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
  });

  it('classifies SDK errors as retryable or final', () => {
    const h = new Headers();
    expect(classify(new Anthropic.RateLimitError(429, {}, 'x', h))).toMatchObject({ code: 'API_RATE_LIMIT', retryable: true });
    expect(classify(new Anthropic.InternalServerError(529, {}, 'x', h))).toMatchObject({ retryable: true });
    expect(classify(new Anthropic.AuthenticationError(401, {}, 'x', h))).toMatchObject({ code: 'API_AUTH', retryable: false });
    expect(classify(new Anthropic.BadRequestError(400, {}, 'x', h))).toMatchObject({ retryable: false });
    expect(classify(new Anthropic.APIConnectionError({ message: 'down' }))).toMatchObject({ retryable: true });
    expect(classify(new Error('?'))).toMatchObject({ code: 'UNEXPECTED', retryable: true });
  });

  it('validates the result shape (3 to 5 tips per language, years 0..60, known sector)', () => {
    expect(() => validateResult({ ...GOOD, inferredYears: -1 }, ['IT'])).toThrow(CvAnalysisError);
    expect(() => validateResult({ ...GOOD, tipsAr: [...GOOD.tipsAr, 'x4 tip', 'x5 tip', 'x6 tip'] }, ['IT'])).toThrow();
    expect(validateResult(GOOD, ['IT']).skills).toEqual(['SQL', 'Power BI', 'Python']);
  });
});

describe('CvAnalysisProcessor', () => {
  async function setup(analyzer: CvAnalyzer, text: string | Error = CV_TEXT) {
    extract.mockReset();
    if (text instanceof Error) extract.mockRejectedValue(text);
    else extract.mockResolvedValue(text);
    const prisma = createFakePrisma();
    const db = prisma.db as any;
    const it = await db.sector.create({ data: { code: 'IT', nameEn: 'ICT', nameAr: 'تقنية', sortOrder: 1 } });
    const file = await db.uploadedFile.create({ data: { storageKey: 'cv/u/1.pdf', mimeType: 'application/pdf' } });
    const analysis = await db.cvAnalysis.create({ data: { seekerId: 'seeker-1', fileId: file.id } });
    const storage = { getBuffer: jest.fn().mockResolvedValue(Buffer.from('%PDF-')) };
    const matching = { add: jest.fn().mockResolvedValue(undefined) };
    const processor = new CvAnalysisProcessor(prisma as any, storage as any, analyzer, matching as any);
    const job = (attemptsMade = 0) => ({ data: { analysisId: analysis.id }, attemptsMade, opts: { attempts: 3 } }) as any;
    return { db, it, analysis, processor, job, matching };
  }

  it('stores a completed analysis and signals profile.updated', async () => {
    const analyze = jest.fn().mockResolvedValue({
      result: { ...GOOD, skills: ['SQL'] },
      model: 'claude-opus-5-5',
      inputTokens: 100,
      outputTokens: 20,
    });
    const c = await setup({ analyze });
    await c.processor.process(c.job());
    const row = c.db.cvAnalysis.rows[0];
    expect(row).toMatchObject({ status: 'COMPLETED', suggestedSectorId: c.it.id, inferredYears: 6, skills: ['SQL'], inputTokens: 100 });
    expect(analyze.mock.calls[0][0].text).toContain('Data Analyst');
    expect(c.matching.add).toHaveBeenCalledWith('profile.updated', expect.objectContaining({ seekerId: 'seeker-1' }), expect.anything());
  });

  it('puts retryable failures back to PENDING and rethrows for a BullMQ retry', async () => {
    const c = await setup({ analyze: jest.fn().mockRejectedValue(new CvAnalysisError('API_RATE_LIMIT', true)) });
    await expect(c.processor.process(c.job(0))).rejects.toMatchObject({ code: 'API_RATE_LIMIT' });
    expect(c.db.cvAnalysis.rows[0]).toMatchObject({ status: 'PENDING', error: 'API_RATE_LIMIT' });
  });

  it('marks FAILED on the last attempt or a final error', async () => {
    const c = await setup({ analyze: jest.fn().mockRejectedValue(new CvAnalysisError('API_RATE_LIMIT', true)) });
    await expect(c.processor.process(c.job(2))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(c.db.cvAnalysis.rows[0]).toMatchObject({ status: 'FAILED', error: 'API_RATE_LIMIT' });

    const d = await setup({ analyze: jest.fn() }, new CvTextError('UNREADABLE'));
    await expect(d.processor.process(d.job(0))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(d.db.cvAnalysis.rows[0]).toMatchObject({ status: 'FAILED', error: 'UNREADABLE' });
  });
});
