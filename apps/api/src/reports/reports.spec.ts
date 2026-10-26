import { ReportsService } from './reports.service';
import { hideSmall, suppressBreakdown, suppressPair } from './suppress';

const MIN = 5;

describe('small-group suppression', () => {
  it('hides a count under 5 and keeps 5 and above', () => {
    expect(hideSmall(0, MIN)).toBeNull();
    expect(hideSmall(4, MIN)).toBeNull();
    expect(hideSmall(5, MIN)).toBe(5);
    expect(hideSmall(120, MIN)).toBe(120);
  });

  it('hides every small category', () => {
    const out = suppressBreakdown(
      [
        { key: 'a', count: 30 },
        { key: 'b', count: 3 },
        { key: 'c', count: 4 },
        { key: 'd', count: 12 },
      ],
      MIN,
    );
    expect(out.map((r) => r.count)).toEqual([30, null, null, 12]);
    expect(out.map((r) => r.key)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('hides the smallest shown category too when only one is hidden (no subtraction)', () => {
    // 43 seekers, 40 men: without the second rule, women = 43 - 40 = 3.
    expect(
      suppressBreakdown(
        [
          { key: 'MALE', count: 40 },
          { key: 'FEMALE', count: 3 },
        ],
        MIN,
      ).map((r) => r.count),
    ).toEqual([null, null]);
    expect(
      suppressBreakdown(
        [
          { key: 'a', count: 20 },
          { key: 'b', count: 7 },
          { key: 'c', count: 2 },
          { key: 'd', count: 9 },
        ],
        MIN,
      ).map((r) => r.count),
    ).toEqual([20, null, null, 9]);
  });

  it('leaves a breakdown alone when nothing is small', () => {
    expect(
      suppressBreakdown(
        [
          { key: 'a', count: 5 },
          { key: 'b', count: 6 },
        ],
        MIN,
      ).map((r) => r.count),
    ).toEqual([5, 6]);
  });

  it('suppresses a pair together, and treats zero as no group', () => {
    expect(suppressPair(20, 3, MIN)).toEqual([null, null]);
    expect(suppressPair(20, 8, MIN)).toEqual([20, 8]);
    expect(suppressPair(0, 8, MIN)).toEqual([0, 8]);
    expect(suppressPair(0, 4, MIN)).toEqual([0, null]);
  });

  it('honours a higher minimum from settings', () => {
    expect(hideSmall(7, 10)).toBeNull();
    expect(
      suppressBreakdown([{ count: 12 }, { count: 9 }, { count: 30 }, { count: 4 }], 10).map((r) => r.count),
    ).toEqual([12, null, 30, null]);
  });
});

describe('ReportsService shaping (server-side, before anything is sent)', () => {
  const service = new ReportsService({} as any);
  const named = (id: string, nameAr: string, nameEn: string, sortOrder = 0, rank?: number) => [
    id,
    { id, nameAr, nameEn, sortOrder, rank },
  ];
  const lk = {
    sectors: new Map([named('s1', 'تقنية', 'IT', 1), named('s2', 'صحة', 'Health', 2)] as any),
    countries: new Map([named('c1', 'السعودية', 'Saudi Arabia', 1), named('c2', 'مصر', 'Egypt', 2)] as any),
    levels: new Map([
      named('e1', 'ثانوي', 'Secondary', 1, 2),
      named('e2', 'بكالوريوس', 'Bachelor', 2, 4),
      named('e3', 'دكتوراه', 'Doctorate', 3, 6),
    ] as any),
  };

  it('builds the seeker report and never sends a count under 5', () => {
    const agg = [
      { dim: 'total', key: null, n: 43 },
      { dim: 'age', key: '25_34', n: 20 },
      { dim: 'age', key: '18_24', n: 12 },
      { dim: 'age', key: '55_PLUS', n: 2 },
      { dim: 'age', key: '35_44', n: 9 },
      { dim: 'gender', key: 'MALE', n: 25 },
      { dim: 'gender', key: 'FEMALE', n: 18 },
      { dim: 'experience', key: 'YES', n: 30 },
      { dim: 'experience', key: 'NO', n: 13 },
      { dim: 'education', key: 'e1', n: 8 },
      { dim: 'education', key: 'e2', n: 31 },
      { dim: 'education', key: 'e3', n: 4 },
      { dim: 'sector', key: 's1', n: 15 },
      { dim: 'sector', key: 's2', n: 6 },
      { dim: 'nationality', key: 'c1', n: 40 },
      { dim: 'nationality', key: 'c2', n: 3 },
    ];
    const r = service.seekerReport(agg, lk as any, MIN);
    expect(r.total).toBe(43);
    expect(r.withExperience).toBe(30);
    expect(r.withoutExperience).toBe(13);
    // Age bands in their natural order; 55+ (2) hidden, and with it the smallest shown (35-44).
    expect(r.byAge).toEqual([
      { key: '18_24', count: 12 },
      { key: '25_34', count: 20 },
      { key: '35_44', count: null },
      { key: '55_PLUS', count: null },
    ]);
    expect(r.byGender).toEqual([
      { key: 'MALE', count: 25 },
      { key: 'FEMALE', count: 18 },
    ]);
    // Education by rank, highest first; doctorate (4) and the next smallest are hidden.
    expect(r.byEducation.map((x) => [x.key, x.count])).toEqual([
      ['e3', null],
      ['e2', 31],
      ['e1', null],
    ]);
    expect(r.byEducation[1]).toMatchObject({ nameAr: 'بكالوريوس', nameEn: 'Bachelor' });
    expect(r.bySector.map((x) => [x.key, x.count])).toEqual([
      ['s1', 15],
      ['s2', 6],
    ]);
    // Two nationalities, one of them small: both hidden (40 + 3 = 43 would give it away).
    expect(r.byNationality.map((x) => x.count)).toEqual([null, null]);
    const all = JSON.stringify(r);
    for (const n of [2, 3, 4]) expect(all).not.toMatch(new RegExp(`"count":${n}[,}]`));
  });

  it('hides everything when the whole population is under 5', () => {
    const r = service.seekerReport(
      [
        { dim: 'total', key: null, n: 3 },
        { dim: 'gender', key: 'MALE', n: 2 },
        { dim: 'gender', key: 'FEMALE', n: 1 },
        { dim: 'experience', key: 'YES', n: 3 },
      ],
      lk as any,
      MIN,
    );
    expect(r.total).toBeNull();
    expect(r.byGender.every((x) => x.count === null)).toBe(true);
    expect(r.withExperience).toBeNull();
    expect(r.withoutExperience).toBe(0);
  });

  it('builds the job report with statuses and interest requests suppressed', () => {
    const r = service.jobReport(
      [
        { dim: 'total', key: null, n: 15 },
        { dim: 'status', key: 'OPEN', n: 8 },
        { dim: 'status', key: 'HIRED_VIA_PLATFORM', n: 5 },
        { dim: 'status', key: 'CLOSED_WITHOUT_HIRING', n: 2 },
        { dim: 'sector', key: 's1', n: 10 },
        { dim: 'sector', key: 's2', n: 5 },
        { dim: 'interests', key: null, n: 4 },
      ],
      lk as any,
      MIN,
    );
    expect(r.total).toBe(15);
    expect(r.open).toBe(8);
    expect(r.unavailable).toBe(7);
    // Closed without hiring (2) is hidden, and so is the next smallest (hired, 5).
    expect(r.closedWithoutHiring).toBeNull();
    expect(r.hiredViaPlatform).toBeNull();
    expect(r.byStatus).toEqual([
      { key: 'OPEN', count: 8 },
      { key: 'HIRED_VIA_PLATFORM', count: null },
      { key: 'CLOSED_WITHOUT_HIRING', count: null },
    ]);
    expect(r.interestRequests).toBeNull();
    expect(r.bySector.map((x) => x.count)).toEqual([10, 5]);
  });
});
