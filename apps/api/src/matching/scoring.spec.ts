import {
  DEFAULT_MATCH_SETTINGS,
  JobFacts,
  keywords,
  keywordShare,
  normalizeText,
  parseMatchSettings,
  scoreMatch,
  SeekerFacts,
  seekerFacts,
} from './scoring';

const IT = 'sector-it';
const FIN = 'sector-fin';

const seeker = (over: Partial<SeekerFacts> = {}): SeekerFacts => ({
  sectorIds: [IT],
  educationRank: 3,
  years: 5,
  keywordSources: ['محلل بيانات أول', 'Data Analyst'],
  ...over,
});
const job = (over: Partial<JobFacts> = {}): JobFacts => ({
  sectorId: IT,
  requiredEducationRank: 3,
  minYearsExperience: 3,
  title: 'محلل بيانات',
  ...over,
});

describe('scoreMatch: weights 40 / 25 / 25 / 10', () => {
  it('gives 100 when every factor is met', () => {
    const r = scoreMatch(seeker(), job());
    expect(r.score).toBe(100);
    expect(r.label).toBe('SUITABLE');
    expect(r.breakdown).toEqual({
      sector: 40,
      education: 25,
      experience: 25,
      keywords: 10,
      sectorMatch: true,
      educationMet: true,
      experienceMet: true,
      keywordShare: 1,
    });
  });

  it('scores each factor independently', () => {
    expect(scoreMatch(seeker({ sectorIds: [FIN] }), job()).score).toBe(60);
    expect(scoreMatch(seeker({ educationRank: 2 }), job()).score).toBe(75);
    expect(scoreMatch(seeker({ years: 2 }), job()).score).toBe(75);
    expect(scoreMatch(seeker({ keywordSources: [] }), job()).score).toBe(90);
    expect(scoreMatch(seeker({ sectorIds: [], educationRank: null, years: 0, keywordSources: [] }), job()).score).toBe(0);
  });

  it('labels with the thresholds: >=70 suitable, >=45 near, otherwise none', () => {
    expect(scoreMatch(seeker({ keywordSources: [], years: 0 }), job()).score).toBe(65); // 40+25
    expect(scoreMatch(seeker({ keywordSources: [], years: 0 }), job()).label).toBe('NEAR');
    expect(scoreMatch(seeker({ sectorIds: [], keywordSources: [] }), job()).score).toBe(50);
    expect(scoreMatch(seeker({ sectorIds: [], keywordSources: [] }), job()).label).toBe('NEAR');
    expect(scoreMatch(seeker({ sectorIds: [], years: 0, keywordSources: [] }), job()).label).toBe('NONE'); // 25
    expect(scoreMatch(seeker({ keywordSources: [] }), job({ minYearsExperience: 30 })).score).toBe(65);
  });

  it('treats the boundaries as inclusive (70 and 45)', () => {
    const s = { ...DEFAULT_MATCH_SETTINGS, weights: { sector: 45, education: 25, experience: 0, keywords: 30 } };
    // sector+education = 70 of 100
    expect(scoreMatch(seeker({ keywordSources: [] }), job(), s)).toMatchObject({ score: 70, label: 'SUITABLE' });
    const n = { ...DEFAULT_MATCH_SETTINGS, weights: { sector: 45, education: 0, experience: 0, keywords: 55 } };
    expect(scoreMatch(seeker({ keywordSources: [] }), job(), n)).toMatchObject({ score: 45, label: 'NEAR' });
    const below = { ...DEFAULT_MATCH_SETTINGS, weights: { sector: 44, education: 0, experience: 0, keywords: 56 } };
    expect(scoreMatch(seeker({ keywordSources: [] }), job(), below)).toMatchObject({ score: 44, label: 'NONE' });
  });

  it('education: no requirement is always met; higher rank meets a lower requirement; unknown never does', () => {
    expect(scoreMatch(seeker({ educationRank: null }), job({ requiredEducationRank: null })).breakdown.educationMet).toBe(true);
    expect(scoreMatch(seeker({ educationRank: 5 }), job({ requiredEducationRank: 3 })).breakdown.educationMet).toBe(true);
    expect(scoreMatch(seeker({ educationRank: 3 }), job({ requiredEducationRank: 3 })).breakdown.educationMet).toBe(true);
    expect(scoreMatch(seeker({ educationRank: null }), job({ requiredEducationRank: 1 })).breakdown.educationMet).toBe(false);
  });

  it('experience: zero required is always met, equal is met, fewer is not', () => {
    expect(scoreMatch(seeker({ years: 0 }), job({ minYearsExperience: 0 })).breakdown.experienceMet).toBe(true);
    expect(scoreMatch(seeker({ years: 3 }), job({ minYearsExperience: 3 })).breakdown.experienceMet).toBe(true);
    expect(scoreMatch(seeker({ years: 2 }), job({ minYearsExperience: 3 })).breakdown.experienceMet).toBe(false);
  });

  it('sector: any of the seeker sectors counts', () => {
    expect(scoreMatch(seeker({ sectorIds: [FIN, IT] }), job()).breakdown.sectorMatch).toBe(true);
    expect(scoreMatch(seeker({ sectorIds: [] }), job()).breakdown.sectorMatch).toBe(false);
  });

  it('keywords give partial points by the share of title words found', () => {
    const r = scoreMatch(seeker({ keywordSources: ['بيانات العملاء'] }), job({ title: 'محلل بيانات' }));
    expect(r.breakdown.keywordShare).toBe(0.5);
    expect(r.breakdown.keywords).toBe(5);
  });

  it('scales to 0..100 when admin weights do not sum to 100', () => {
    const s = { ...DEFAULT_MATCH_SETTINGS, weights: { sector: 20, education: 20, experience: 0, keywords: 0 } };
    expect(scoreMatch(seeker({ educationRank: 1 }), job(), s).score).toBe(50);
    const zero = { ...DEFAULT_MATCH_SETTINGS, weights: { sector: 0, education: 0, experience: 0, keywords: 0 } };
    expect(scoreMatch(seeker(), job(), zero).score).toBe(0);
  });

  it('is deterministic and never outside 0..100', () => {
    for (let i = 0; i < 200; i++) {
      const r = scoreMatch(
        seeker({ years: i % 7, educationRank: i % 5, sectorIds: i % 2 ? [IT] : [] }),
        job({ minYearsExperience: i % 4, requiredEducationRank: i % 3 === 0 ? null : (i % 5) + 1 }),
      );
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      expect(r.score).toBe(r.breakdown.sector + r.breakdown.education + r.breakdown.experience + r.breakdown.keywords);
    }
  });
});

describe('keywords (Arabic and English)', () => {
  it('normalises Arabic letter forms, diacritics, tatweel and digits', () => {
    expect(normalizeText('مُحَاسِبـــة إدارة ٣')).toBe('محاسبه اداره 3');
    expect(normalizeText('مستشفى')).toBe('مستشفي');
  });

  it('drops the definite article, stop words and one-letter words', () => {
    expect([...keywords('المحاسب في الشركة و a Senior Accountant')]).toEqual([
      'محاسب',
      'شركه',
      'senior',
      'accountant',
    ]);
  });

  it('matches across the definite article and letter forms', () => {
    expect(keywordShare('محاسب أول', ['المحاسب الاول'])).toBe(1);
    expect(keywordShare('Data Analyst', ['senior data analyst'])).toBe(1);
    expect(keywordShare('Data Analyst', [])).toBe(0);
    expect(keywordShare('في و من', ['anything'])).toBe(0);
  });
});

describe('parseMatchSettings', () => {
  it('reads valid settings', () => {
    expect(
      parseMatchSettings({ sector: 50, education: 20, experience: 20, keywords: 10 }, { suitable: 80, near: 50 }),
    ).toEqual({
      weights: { sector: 50, education: 20, experience: 20, keywords: 10 },
      thresholds: { suitable: 80, near: 50 },
    });
  });

  it('falls back to the defaults for missing or malformed values', () => {
    expect(parseMatchSettings(null, undefined)).toEqual(DEFAULT_MATCH_SETTINGS);
    expect(parseMatchSettings({ sector: '40' }, { suitable: 40, near: 60 })).toEqual(DEFAULT_MATCH_SETTINGS);
    expect(parseMatchSettings({ sector: -1, education: 1, experience: 1, keywords: 1 }, {}).weights).toEqual(
      DEFAULT_MATCH_SETTINGS.weights,
    );
    expect(parseMatchSettings(undefined, { suitable: 101, near: 1 }).thresholds).toEqual(
      DEFAULT_MATCH_SETTINGS.thresholds,
    );
  });
});

describe('seekerFacts', () => {
  const base = {
    analysisSectorId: null,
    positionSectorIds: [],
    educationRank: 3,
    hasExperience: true,
    yearsOfExperience: 4,
    inferredYears: 9,
    positionTitles: ['Analyst'],
    fieldOfStudy: 'Statistics',
    skills: ['SQL'],
  };

  it('collects the CV-analysis sector and the position sectors, without duplicates', () => {
    expect(seekerFacts({ ...base, analysisSectorId: IT, positionSectorIds: [IT, FIN, null] }).sectorIds).toEqual([
      IT,
      FIN,
    ]);
    expect(seekerFacts(base).sectorIds).toEqual([]);
  });

  it('uses declared years, then CV-inferred years, and 0 without experience', () => {
    expect(seekerFacts(base).years).toBe(4);
    expect(seekerFacts({ ...base, yearsOfExperience: null }).years).toBe(9);
    expect(seekerFacts({ ...base, yearsOfExperience: null, inferredYears: null }).years).toBe(0);
    expect(seekerFacts({ ...base, hasExperience: false }).years).toBe(0);
  });

  it('takes keywords from titles, field of study and skills', () => {
    expect(seekerFacts(base).keywordSources).toEqual(['Analyst', 'Statistics', 'SQL']);
    expect(seekerFacts({ ...base, fieldOfStudy: null }).keywordSources).toEqual(['Analyst', 'SQL']);
  });
});
