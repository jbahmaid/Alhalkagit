'use client';

import {
  forwardRef,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from './Icon';

const INPUT =
  'w-full min-h-touch rounded-md border border-border bg-surface px-3 py-[9px] text-base text-text placeholder:text-text-muted focus-visible:border-focus aria-[invalid=true]:border-danger';

interface Described {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
}

/** Ids for the hint and error, joined for aria-describedby. */
function useDescribedBy(id: string, hint?: ReactNode, error?: ReactNode) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return { hintId, errorId, describedBy: [hintId, errorId].filter(Boolean).join(' ') || undefined };
}

function Label({ htmlFor, label, optional }: { htmlFor: string; label: ReactNode; optional?: boolean }) {
  const t = useTranslations('common');
  return (
    <label htmlFor={htmlFor} className="text-[15px] font-medium">
      {label}
      {optional && <span className="ms-1 text-[13px] font-normal text-text-muted">({t('optional')})</span>}
    </label>
  );
}

export function FieldMessages({
  hintId,
  hint,
  errorId,
  error,
}: {
  hintId?: string;
  hint?: ReactNode;
  errorId?: string;
  error?: ReactNode;
}) {
  return (
    <>
      {hint && (
        <p id={hintId} className="m-0 text-[13px] text-text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="m-0 flex items-start gap-1.5 text-sm font-medium text-danger">
          <Icon name="warn" className="mt-0.5 h-4 w-4" />
          <span>{error}</span>
        </p>
      )}
    </>
  );
}

export type TextFieldProps = Described & InputHTMLAttributes<HTMLInputElement> & { ltr?: boolean };

/** Text input with a visible label, optional hint and an error linked by aria-describedby. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, optional, id, ltr, className = '', ...rest },
  ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  const { hintId, errorId, describedBy } = useDescribedBy(fid, hint, error);
  return (
    <div className="mb-4 flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={fid} label={label} optional={optional} />
      <input
        ref={ref}
        id={fid}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        required={!optional}
        dir={ltr ? 'ltr' : undefined}
        className={`${INPUT} ${ltr ? 'text-start rtl:text-right' : ''} ${className}`}
        {...rest}
      />
      <FieldMessages hintId={hintId} hint={hint} errorId={errorId} error={error} />
    </div>
  );
});

/** Password input with a show/hide toggle (44px target). */
export const PasswordField = forwardRef<HTMLInputElement, Omit<TextFieldProps, 'type'>>(
  function PasswordField({ label, hint, error, optional, id, className = '', ...rest }, ref) {
    const t = useTranslations('common');
    const auto = useId();
    const fid = id ?? auto;
    const [shown, setShown] = useState(false);
    const { hintId, errorId, describedBy } = useDescribedBy(fid, hint, error);
    return (
      <div className="mb-4 flex min-w-0 flex-col gap-1.5">
        <Label htmlFor={fid} label={label} optional={optional} />
        <div className="relative">
          <input
            ref={ref}
            id={fid}
            type={shown ? 'text' : 'password'}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            required={!optional}
            dir="ltr"
            className={`${INPUT} pe-12 text-start rtl:text-right ${className}`}
            {...rest}
          />
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            aria-label={shown ? t('hidePassword') : t('showPassword')}
            aria-pressed={shown}
            aria-controls={fid}
            className="absolute inset-y-0 end-0 flex min-w-touch items-center justify-center rounded-md text-text-muted hover:text-text"
          >
            <Icon name={shown ? 'eyeOff' : 'eye'} />
          </button>
        </div>
        <FieldMessages hintId={hintId} hint={hint} errorId={errorId} error={error} />
      </div>
    );
  },
);

export type SelectOption = { value: string; label: string };
export type SelectFieldProps = Described &
  SelectHTMLAttributes<HTMLSelectElement> & { options: SelectOption[]; placeholder?: string };

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, hint, error, optional, id, options, placeholder, className = '', ...rest },
  ref,
) {
  const t = useTranslations('common');
  const auto = useId();
  const fid = id ?? auto;
  const { hintId, errorId, describedBy } = useDescribedBy(fid, hint, error);
  return (
    <div className="mb-4 flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={fid} label={label} optional={optional} />
      <select
        ref={ref}
        id={fid}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        required={!optional}
        className={`${INPUT} ${className}`}
        {...rest}
      >
        <option value="">{placeholder ?? t('choose')}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <FieldMessages hintId={hintId} hint={hint} errorId={errorId} error={error} />
    </div>
  );
});

export type TextAreaFieldProps = Described & TextareaHTMLAttributes<HTMLTextAreaElement>;

/** Multi-line text with the same label, hint and error wiring as TextField. */
export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(function TextAreaField(
  { label, hint, error, optional, id, className = '', ...rest },
  ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  const { hintId, errorId, describedBy } = useDescribedBy(fid, hint, error);
  return (
    <div className="mb-4 flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={fid} label={label} optional={optional} />
      <textarea
        ref={ref}
        id={fid}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        required={!optional}
        rows={6}
        className={`${INPUT} min-h-[140px] ${className}`}
        {...rest}
      />
      <FieldMessages hintId={hintId} hint={hint} errorId={errorId} error={error} />
    </div>
  );
});

/** Single 6-digit code input (inputmode numeric, autocomplete one-time-code). */
export const OtpInput = forwardRef<
  HTMLInputElement,
  Omit<TextFieldProps, 'type' | 'onChange'> & { onValueChange: (v: string) => void; length?: number }
>(function OtpInput({ onValueChange, length = 6, className = '', ...rest }, ref) {
  return (
    <TextField
      ref={ref}
      ltr
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern={`[0-9]{${length}}`}
      maxLength={length}
      className={`max-w-[260px] !text-center text-2xl tracking-[0.4em] tabular-nums ${className}`}
      onChange={(e) => {
        const ascii = e.target.value.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
        onValueChange(ascii.replace(/\D/g, '').slice(0, length));
      }}
      {...rest}
    />
  );
});

export function Checkbox({
  label,
  error,
  id,
  ...rest
}: { label: ReactNode; error?: ReactNode } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const auto = useId();
  const fid = id ?? auto;
  const errorId = error ? `${fid}-error` : undefined;
  return (
    <div className="mb-1">
      <label htmlFor={fid} className="flex min-h-touch cursor-pointer items-start gap-2.5 py-2.5">
        <input
          id={fid}
          type="checkbox"
          aria-describedby={errorId}
          aria-invalid={error ? true : undefined}
          className="mt-[3px] h-5 w-5 flex-none accent-primary"
          {...rest}
        />
        <span>{label}</span>
      </label>
      <FieldMessages errorId={errorId} error={error} />
    </div>
  );
}

/** Radio group in a fieldset with a legend; each choice is a full 44px row. */
export function ChoiceGroup({
  legend,
  name,
  options,
  value,
  onChange,
  error,
}: {
  legend: ReactNode;
  name: string;
  options: SelectOption[];
  value: string | null;
  onChange: (value: string) => void;
  error?: ReactNode;
}) {
  const auto = useId();
  const errorId = error ? `${auto}-error` : undefined;
  return (
    <fieldset className="mb-4 min-w-0 border-0 p-0" aria-describedby={errorId}>
      <legend className="mb-1.5 text-[15px] font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            className="flex min-h-touch flex-[1_1_130px] cursor-pointer items-center gap-2.5 rounded-md border border-border bg-surface px-3.5 py-2 font-medium has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus"
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="h-5 w-5 flex-none accent-primary"
            />
            {o.label}
          </label>
        ))}
      </div>
      <FieldMessages errorId={errorId} error={error} />
    </fieldset>
  );
}
