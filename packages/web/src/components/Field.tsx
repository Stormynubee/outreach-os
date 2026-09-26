import { useEffect, useId, useState } from 'react';
import type { InputHTMLAttributes, ReactElement, ReactNode } from 'react';

import { cx } from '../lib/cx';
import { IconChevronDown } from './icons';

export const inputClass =
  'w-full rounded-2xl border border-ink/10 bg-page/70 px-4 py-3 text-[15px] font-semibold text-ink transition-colors placeholder:font-medium placeholder:text-muted focus:border-ink/25 focus:bg-white focus:outline-none disabled:opacity-50';

export const textareaClass = cx(inputClass, 'min-h-[96px] resize-y leading-relaxed');

export interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

/** Label + control + hint, wired up with a real <label for>. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required = false,
  children,
  className,
}: FieldProps): ReactElement {
  return (
    <div className={cx('space-y-1.5', className)}>
      <label
        htmlFor={htmlFor}
        className="flex items-center gap-1.5 text-[12px] font-bold tracking-[0.01em] text-ink"
      >
        {label}
        {required ? (
          <span className="text-[11px] font-semibold text-muted" aria-hidden="true">
            required
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-[12px] font-semibold text-ink">
          {error}
        </p>
      ) : null}
      {hint ? <p className="text-[12px] font-medium text-muted">{hint}</p> : null}
    </div>
  );
}

export interface TextInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'id' | 'className'> {
  value: string;
  onValueChange: (next: string) => void;
  label?: string;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
  inputClassName?: string;
}

export function TextInput({
  value,
  onValueChange,
  label,
  hint,
  error,
  className,
  inputClassName,
  ...rest
}: TextInputProps): ReactElement {
  const autoId = useId();
  const input = (
    <input
      {...rest}
      id={rest.name ?? autoId}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      className={cx(inputClass, inputClassName)}
    />
  );

  if (!label) return input;

  return (
    <Field label={label} htmlFor={rest.name ?? autoId} hint={hint} error={error} className={className}>
      {input}
    </Field>
  );
}

export interface NumberInputProps {
  value: number;
  onValueChange: (next: number) => void;
  label?: string;
  hint?: ReactNode;
  error?: string | null;
  min?: number;
  max?: number;
  step?: number;
  suffix?: ReactNode;
  placeholder?: string;
  name?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Number field that lets you clear the box while typing (the parent only sees
 * a number once the text parses) and clamps to min/max on commit.
 */
export function NumberInput({
  value,
  onValueChange,
  label,
  hint,
  error,
  min,
  max,
  step = 1,
  suffix,
  placeholder,
  name,
  disabled,
  className,
}: NumberInputProps): ReactElement {
  const autoId = useId();
  const inputId = name ?? autoId;
  const [text, setText] = useState(() => String(value));

  useEffect(() => {
    setText((prev) => (Number(prev) === value ? prev : String(value)));
  }, [value]);

  const commit = (next: string): void => {
    setText(next);
    const parsed = Number(next);
    if (next.trim() === '' || !Number.isFinite(parsed)) return;
    let clamped = parsed;
    if (typeof min === 'number') clamped = Math.max(min, clamped);
    if (typeof max === 'number') clamped = Math.min(max, clamped);
    onValueChange(clamped);
  };

  const input = (
    <div className="relative">
      <input
        id={inputId}
        name={name}
        type="number"
        inputMode="numeric"
        value={text}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => commit(event.target.value)}
        onBlur={() => {
          if (text.trim() === '' || !Number.isFinite(Number(text))) setText(String(value));
        }}
        className={cx(inputClass, 'tabular-nums', suffix ? 'pr-14' : undefined)}
      />
      {suffix ? (
        <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-[12px] font-bold text-muted">
          {suffix}
        </span>
      ) : null}
    </div>
  );

  if (!label) return input;

  return (
    <Field label={label} htmlFor={inputId} hint={hint} error={error} className={className}>
      {input}
    </Field>
  );
}

export interface TextAreaProps {
  value: string;
  onValueChange: (next: string) => void;
  label?: string;
  hint?: ReactNode;
  error?: string | null;
  rows?: number;
  placeholder?: string;
  name?: string;
  className?: string;
  ariaLabel?: string;
}

export function TextArea({
  value,
  onValueChange,
  label,
  hint,
  error,
  rows = 4,
  placeholder,
  name,
  className,
  ariaLabel,
}: TextAreaProps): ReactElement {
  const autoId = useId();
  const areaId = name ?? autoId;
  const area = (
    <textarea
      id={areaId}
      name={name}
      rows={rows}
      value={value}
      aria-label={ariaLabel ?? (label ? undefined : 'Text')}
      placeholder={placeholder}
      onChange={(event) => onValueChange(event.target.value)}
      className={textareaClass}
    />
  );

  if (!label) return area;

  return (
    <Field label={label} htmlFor={areaId} hint={hint} error={error} className={className}>
      {area}
    </Field>
  );
}

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export interface SelectProps<T extends string> {
  value: T;
  onValueChange: (next: T) => void;
  options: readonly SelectOption<T>[];
  label?: string;
  hint?: ReactNode;
  error?: string | null;
  name?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}

export function Select<T extends string>({
  value,
  onValueChange,
  options,
  label,
  hint,
  error,
  name,
  ariaLabel,
  disabled,
  className,
}: SelectProps<T>): ReactElement {
  const autoId = useId();
  const selectId = name ?? autoId;

  const control = (
    <div className="relative">
      <select
        id={selectId}
        name={name}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel ?? (label ? undefined : 'Select')}
        onChange={(event) => {
          const next = options.find((option) => option.value === event.target.value);
          if (next) onValueChange(next.value);
        }}
        className={cx(inputClass, 'appearance-none pr-10')}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <IconChevronDown className="pointer-events-none absolute top-1/2 right-3.5 h-4 w-4 -translate-y-1/2 text-muted" />
    </div>
  );

  if (!label) return <div className={className}>{control}</div>;

  return (
    <Field label={label} htmlFor={selectId} hint={hint} error={error} className={className}>
      {control}
    </Field>
  );
}
