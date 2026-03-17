"use client";

import { forwardRef, type InputHTMLAttributes } from "react";

import styles from "../styles/inscription.module.css";

type FormFieldProps = {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
} & InputHTMLAttributes<HTMLInputElement>;

export const FormField = forwardRef<HTMLInputElement, FormFieldProps>(function FormField(
  { id, label, hint, error, required = false, className, ...inputProps },
  ref,
) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={styles.fieldWrap}>
      <label className={styles.fieldLabel} htmlFor={id}>
        <span>{label}</span>
        {required && <span className={styles.requiredMark}>*</span>}
      </label>
      <input
        ref={ref}
        id={id}
        className={`${styles.fieldInput} ${error ? styles.fieldInputError : ""} ${className ?? ""}`.trim()}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy || undefined}
        {...inputProps}
      />
      {hint && (
        <p id={`${id}-hint`} className={styles.fieldHint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className={styles.fieldError} role="alert">
          {error}
        </p>
      )}
    </div>
  );
});