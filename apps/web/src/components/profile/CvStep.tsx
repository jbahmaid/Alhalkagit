'use client';

import {
  CV_ACCEPT,
  CV_EXTENSIONS,
  CV_MAX_BYTES,
  type CvAnalysisDto,
  type FileLinkDto,
  type ProfileDto,
} from '@sanad/shared';
import { useLocale, useTranslations } from 'next-intl';
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState, type DragEvent } from 'react';
import { api, upload } from '@/lib/api';
import { useApiErrors } from '@/lib/errors';
import { formatBytes, formatDate } from '@/lib/format';
import { useLookupName } from '@/lib/lookups';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  Icon,
  Note,
  SelectField,
  Spinner,
  useToast,
} from '@/components/ui';
import type { StepHandle, StepProps } from './step-kit';

const POLL_MS = 4000;
const POLL_MAX = 45;
const busyStatus = (a: CvAnalysisDto | null | undefined) =>
  a?.status === 'PENDING' || a?.status === 'PROCESSING';

/** Step 6 / S-06: CV upload, replace, remove, download and the analysis card (FR-2.1.9). */
export const CvStep = forwardRef<StepHandle, StepProps>(function CvStep({ profile, lists, onProfile }, ref) {
  const t = useTranslations('profile');
  const errs = useApiErrors();
  const toast = useToast();
  const locale = useLocale();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const cv = profile.cv;
  const file = cv.file;

  // The step has nothing to save: uploads and removals happen right away.
  useImperativeHandle(ref, () => ({ save: async () => profile }));

  // Poll while the worker analyses the CV.
  const analysisBusy = busyStatus(cv.analysis);
  useEffect(() => {
    if (!analysisBusy) return;
    let n = 0;
    const timer = setInterval(async () => {
      n += 1;
      try {
        const fresh = await api<ProfileDto>('/me/profile');
        if (!busyStatus(fresh.cv.analysis) || n >= POLL_MAX) clearInterval(timer);
        onProfile(fresh);
      } catch {
        if (n >= POLL_MAX) clearInterval(timer);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [analysisBusy, onProfile]);

  async function send(f: File) {
    setError(null);
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    if (!(CV_EXTENSIONS as readonly string[]).includes(ext)) return setError(t('badType'));
    if (f.size > CV_MAX_BYTES) return setError(t('tooLarge'));
    const form = new FormData();
    form.append('file', f, f.name);
    setProgress(0);
    try {
      const saved = await upload<ProfileDto>('/me/profile/cv', form, (x) => setProgress(Math.round(x * 100)));
      onProfile(saved);
      toast(t('cvUploaded'));
    } catch (err) {
      setError(errs.message(err));
    } finally {
      setProgress(null);
      if (input.current) input.current.value = '';
    }
  }

  async function remove() {
    setRemoving(true);
    try {
      onProfile(await api<ProfileDto>('/me/profile/cv', { method: 'DELETE' }));
      setConfirmRemove(false);
      toast(t('cvRemoved'));
    } catch (err) {
      setError(errs.message(err));
      setConfirmRemove(false);
    } finally {
      setRemoving(false);
    }
  }

  async function download() {
    setDownloading(true);
    setError(null);
    try {
      const link = await api<FileLinkDto>('/me/profile/cv/link', { method: 'POST' });
      // Content-Disposition: attachment, so the page stays where it is.
      window.location.assign(link.url);
    } catch (err) {
      setError(errs.message(err));
    } finally {
      setDownloading(false);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void send(f);
  }

  const uploading = progress !== null;
  const fileInput = (
    <input
      ref={input}
      id={inputId}
      type="file"
      accept={CV_ACCEPT}
      className="sr-only"
      aria-describedby={`${inputId}-hint`}
      disabled={uploading}
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) void send(f);
      }}
    />
  );

  return (
    <>
      <p className="mt-0 text-text-muted">{t('cvLead')}</p>
      <p className="mt-0 text-sm text-text-muted">{t('cvOptional')}</p>
      <Alert>{error}</Alert>
      {uploading && (
        <div className="mb-4" aria-live="polite">
          <p className="mb-1.5 mt-0 flex items-center gap-2 text-sm font-medium">
            <Spinner />
            {t('uploading', { percent: progress })}
          </p>
          <div
            role="progressbar"
            aria-label={t('dropText')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            className="h-1.5 overflow-hidden rounded-pill bg-surface-2"
          >
            <span
              className="block h-full rounded-pill bg-primary transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
      {file ? (
        <Card className="mb-4 flex flex-wrap items-center gap-3">
          <Icon name="file" className="h-6 w-6 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="m-0 break-words font-medium [overflow-wrap:anywhere]" dir="auto">
              {file.originalName}
            </p>
            <p className="m-0 text-[13px] text-text-muted">
              <span dir="ltr">{formatBytes(file.sizeBytes)}</span> ·{' '}
              {t('uploadedOn', { date: formatDate(file.uploadedAt, locale) })}
              {cv.previousVersions > 0 && <> · {t('previousKept', { count: cv.previousVersions })}</>}
            </p>
          </div>
          <Badge variant="match" icon="check">
            {t('uploaded')}
          </Badge>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <Button variant="secondary" size="sm" onClick={download} loading={downloading}>
              <Icon name="download" className="h-4 w-4" />
              {t('download')}
            </Button>
            <label
              htmlFor={inputId}
              className="inline-flex min-h-touch cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-semibold hover:bg-surface-2 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus"
            >
              <Icon name="upload" className="h-4 w-4" />
              {t('replace')}
              {fileInput}
            </label>
            <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(true)}>
              <Icon name="x" className="h-4 w-4" />
              {t('remove')}
            </Button>
          </div>
          <p id={`${inputId}-hint`} className="sr-only">
            {t('dropHint')}
          </p>
        </Card>
      ) : (
        <label
          htmlFor={inputId}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`mb-4 flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed bg-surface px-4 py-6 text-center hover:border-primary has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${
            dragging ? 'border-primary bg-primary-soft' : 'border-border'
          }`}
        >
          <Icon name="upload" className="h-8 w-8 text-primary" />
          <strong>{t('dropText')}</strong>
          <span id={`${inputId}-hint`} className="text-sm text-text-muted">
            {t('dropHint')}
          </span>
          <span className="hidden text-[13px] text-text-muted md:inline">{t('dropHere')}</span>
          {fileInput}
        </label>
      )}
      <AnalysisCard profile={profile} lists={lists} onProfile={onProfile} />
      <Dialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title={t('removeTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmRemove(false)}>
              {t('back')}
            </Button>
            <Button variant="danger" onClick={remove} loading={removing}>
              {t('remove')}
            </Button>
          </>
        }
      >
        <p className="m-0">{t('removeBody')}</p>
      </Dialog>
    </>
  );
});

/** The analysis card: "available when activated", progress, failure, or results with a correctable sector. */
function AnalysisCard({ profile, lists, onProfile }: StepProps) {
  const t = useTranslations('profile');
  const errs = useApiErrors();
  const toast = useToast();
  const locale = useLocale();
  const name = useLookupName();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { analysisEnabled, analysis, file } = profile.cv;
  const done = analysis?.status === 'COMPLETED';

  let badge = (
    <Badge variant="info" icon="info">
      {t('whenActive')}
    </Badge>
  );
  if (analysisEnabled && file && analysis) {
    if (busyStatus(analysis))
      badge = (
        <Badge variant="info" icon="clock">
          {t('statusPending')}
        </Badge>
      );
    else if (analysis.status === 'FAILED')
      badge = (
        <Badge variant="danger" icon="warn">
          {t('statusFailed')}
        </Badge>
      );
    else if (done)
      badge = (
        <Badge variant="match" icon="check">
          {t('statusDone')}
        </Badge>
      );
  }

  async function correct(sectorId: string) {
    setSaving(true);
    setError(null);
    try {
      await api<CvAnalysisDto>('/me/profile/cv/analysis', {
        method: 'PATCH',
        body: { sectorId: sectorId || null },
      });
      onProfile(await api<ProfileDto>('/me/profile'));
      toast(t('sectorSaved'));
    } catch (err) {
      setError(errs.message(err));
    } finally {
      setSaving(false);
    }
  }

  let body;
  if (!analysisEnabled || (file && analysis?.status === 'SKIPPED')) {
    body = <Note kind="info">{t('analysisNote')}</Note>;
  } else if (!file || !analysis) {
    body = <p className="m-0 text-text-muted">{t('analysisNoCv')}</p>;
  } else if (busyStatus(analysis)) {
    body = (
      <p className="m-0 flex items-center gap-2" role="status">
        <Spinner />
        {t('analysisPending')}
      </p>
    );
  } else if (analysis.status === 'FAILED') {
    body = <Note kind="warn">{t('analysisFailed')}</Note>;
  } else {
    const tips = locale === 'ar' ? analysis.tipsAr : analysis.tipsEn;
    body = (
      <>
        <Alert>{error}</Alert>
        <SelectField
          id="w-sec"
          label={t('suggestedSector')}
          hint={t('sectorFix')}
          optional
          options={(lists.sectors ?? []).map((s) => ({ value: s.id, label: name(s) }))}
          value={analysis.sectorId ?? ''}
          disabled={saving}
          onChange={(e) => void correct(e.target.value)}
        />
        {analysis.skills.length > 0 && (
          <>
            <h3 className="mb-2 mt-0 text-base font-semibold">{t('skills')}</h3>
            <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
              {analysis.skills.map((s) => (
                <li key={s} dir="auto" className="rounded-pill bg-surface-2 px-2.5 py-1 text-[13px]">
                  {s}
                </li>
              ))}
            </ul>
          </>
        )}
        <dl className="my-4 grid grid-cols-[minmax(110px,40%)_1fr] gap-x-3 gap-y-2 text-[15px]">
          <dt className="text-text-muted">{t('inferredYears')}</dt>
          <dd className="m-0 font-medium">{analysis.inferredYears ?? '—'}</dd>
        </dl>
        {tips.length > 0 && (
          <>
            <h3 className="mb-2 mt-0 text-base font-semibold">{t('tips')}</h3>
            <ol className="m-0 ps-5">
              {tips.map((tip, i) => (
                <li key={i} className="mb-1.5">
                  {tip}
                </li>
              ))}
            </ol>
          </>
        )}
      </>
    );
  }

  return (
    <section
      aria-labelledby="an-h"
      className="min-w-0 rounded-lg border border-dashed border-info bg-surface p-4 shadow-sm md:px-6 md:py-5"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="an-h" className="m-0 flex items-center gap-2 text-lg font-semibold">
          <Icon name="spark" className="h-5 w-5 text-primary" />
          {t('analysisTitle')}
        </h2>
        {badge}
      </div>
      {body}
    </section>
  );
}
