import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  loading,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  loading?: boolean;
}) {
  return (
    <button className={`btn btn-${variant} btn-${size} ${className}`} disabled={props.disabled || loading} {...props}>
      {loading ? <span className="btn-spinner" /> : icon}
      <span>{children}</span>
    </button>
  );
}

export function IconButton({
  children,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`icon-btn ${className}`} {...props}>{children}</button>;
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 560,
  className = '',
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  className?: string;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Render into <body> so the dialog is never trapped by a scrolling/animated
  // page stack, and always sits above the titlebar/update banner/toasts.
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className={`modal ${className}`} style={{ maxWidth: width }} role="dialog" aria-modal="true">
        <div className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton onClick={onClose} aria-label="Close"><X size={18} /></IconButton>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Styled replacement for window.prompt, with the text selected on open. */
export function PromptModal({
  title,
  subtitle,
  label,
  initialValue,
  placeholder,
  confirmLabel = 'Save',
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  subtitle?: string;
  label: string;
  initialValue: string;
  placeholder?: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: (value: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const valid = value.trim().length > 0;

  function submit() {
    if (valid && !busy) void onConfirm(value.trim());
  }

  return (
    <Modal
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      width={460}
      className="prompt-modal"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} loading={busy} disabled={!valid}>{confirmLabel}</Button>
      </>}
    >
      <div className="form-grid">
        <Field label={label} hint="Press Enter to save, Escape to cancel.">
          <input
            autoFocus
            value={value}
            placeholder={placeholder}
            maxLength={64}
            onChange={(event) => setValue(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
              }
            }}
          />
        </Field>
      </div>
    </Modal>
  );
}

/** Styled replacement for window.confirm. Optional children add extra choices. */
export function ConfirmModal({
  title,
  description,
  confirmLabel = 'Confirm',
  danger,
  busy,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={460}
      className="confirm-modal"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={() => void onConfirm()} loading={busy}>{confirmLabel}</Button>
      </>}
    >
      <div className="confirm-copy">
        <p>{description}</p>
        {children}
      </div>
    </Modal>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="toggle-row">
      <div className="toggle-copy">
        <strong>{label}</strong>
        {description && <span>{description}</span>}
      </div>
      <button
        type="button"
        className={`toggle ${checked ? 'on' : ''}`}
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
      >
        <span />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? 'active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function Spinner({ size = 20 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} />;
}
