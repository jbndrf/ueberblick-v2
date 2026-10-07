// The UI contract: component props as types. Written first; components implement it.
// Tokens are data (principle 10): a theme is a plain object that emits CSS custom properties.
import type { Snippet } from 'svelte';
import type { ButtonVariant, StatusKind, ThemeName } from '@ueberblick/core/registry';

export interface ColorPair {
  readonly name: string;
  readonly fg: string;
  readonly bg: string;
}

export interface StatusColors {
  readonly fg: string;
  readonly bg: string;
}

export interface ThemeTokens {
  readonly name: ThemeName;
  readonly color: {
    readonly bg: string;
    readonly surface: string;
    readonly text: string;
    readonly textMuted: string;
    readonly border: string;
    readonly focus: string;
    readonly primary: string;
    readonly onPrimary: string;
    readonly danger: string;
    readonly onDanger: string;
    readonly scrim: string;
    readonly statusOnline: StatusColors;
    readonly statusOffline: StatusColors;
    readonly statusPending: StatusColors;
    readonly statusRefused: StatusColors;
  };
  readonly space: Readonly<Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', string>>;
  readonly radius: Readonly<Record<'sm' | 'md' | 'lg' | 'pill', string>>;
  readonly elevation: Readonly<Record<'raised' | 'overlay', string>>;
  readonly type: Readonly<Record<string, string>>;
}

/** An icon is data: one or more SVG path strings on a 24x24 grid. Drawn with `currentColor`. */
export interface IconDef {
  readonly name: string;
  readonly paths: readonly string[];
}

export interface IconProps {
  icon: IconDef;
  /** Accessible name. Omit for a decorative icon (rendered `aria-hidden`). */
  label?: string;
  size?: number;
}

export interface ButtonProps {
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  onclick?: (e: MouseEvent) => void;
  children: Snippet;
}

export interface IconButtonProps {
  icon: IconDef;
  /** Required accessible name: an icon-only control has no visible text. */
  label: string;
  disabled?: boolean;
  onclick?: (e: MouseEvent) => void;
}

export interface TextFieldProps {
  id: string;
  label: string;
  value?: string;
  type?: 'text' | 'email' | 'number' | 'tel' | 'password' | 'search' | 'url';
  hint?: string;
  /** Error message; when set the field is `aria-invalid` and the message is announced with the field. */
  error?: string;
  required?: boolean;
  disabled?: boolean;
}

export interface FieldError {
  /** `id` of the field the message belongs to. */
  fieldId: string;
  message: string;
}

export interface ErrorSummaryProps {
  errors: readonly FieldError[];
}

export interface SheetProps {
  open: boolean;
  title: string;
  /** Called for the close button, Escape and the backdrop. Dragging is never required (WCAG 2.5.7). */
  onclose: () => void;
  children: Snippet;
}

export interface StatusBadgeProps {
  status: StatusKind;
}
