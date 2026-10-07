/**
 * v3's Feldtypen palette (`@lib/registry` `SELECTABLE_FIELD_DESCRIPTORS`, `FieldTypesPalette.svelte`), as property
 * types of the engine. A long text and an e-mail address are a `text` property whose form entry carries the
 * appearance (`FORM_APPEARANCES`); a Smart Dropdown is a select whose form entry carries a `choice_filter`, and the
 * entity selector (v3 `smart_dropdown`, `custom_table_selector`) a reference to a table or a participant (WP-393).
 */
import AlignLeft from '@lucide/svelte/icons/align-left';
import Calendar from '@lucide/svelte/icons/calendar';
import CalendarClock from '@lucide/svelte/icons/calendar-clock';
import ChevronDown from '@lucide/svelte/icons/chevron-down';
import Clock from '@lucide/svelte/icons/clock';
import Hash from '@lucide/svelte/icons/hash';
import Languages from '@lucide/svelte/icons/languages';
import Link from '@lucide/svelte/icons/link';
import List from '@lucide/svelte/icons/list';
import MapPin from '@lucide/svelte/icons/map-pin';
import Mail from '@lucide/svelte/icons/mail';
import SquareCheck from '@lucide/svelte/icons/square-check';
import Sparkles from '@lucide/svelte/icons/sparkles';
import Table from '@lucide/svelte/icons/table';
import Type from '@lucide/svelte/icons/type';
import Upload from '@lucide/svelte/icons/upload';
import Users from '@lucide/svelte/icons/users';
import type { Component } from 'svelte';
import type { FormAppearance, PropertyTypeKey } from '@ueberblick/core';

export interface PaletteTile {
  readonly key: string;
  readonly type: PropertyTypeKey;
  readonly appearance?: FormAppearance;
  readonly icon: Component;
  /** v3 `smart_dropdown`: a select whose form entry gets a `choice_filter` (WP-393). */
  readonly smart?: true;
  /** v3 `custom_table_selector`: a reference to a table, or a participant property (WP-393). */
  readonly entity?: true;
}

export const PALETTE_TILES: readonly PaletteTile[] = [
  { key: 'short_text', type: 'text', icon: Type },
  { key: 'long_text', type: 'text', appearance: 'multiline', icon: AlignLeft },
  { key: 'number', type: 'number', icon: Hash },
  { key: 'email', type: 'text', appearance: 'email', icon: Mail },
  { key: 'date', type: 'date', icon: Calendar },
  { key: 'file', type: 'file', icon: Upload },
  { key: 'dropdown', type: 'select', icon: ChevronDown },
  { key: 'multiple_choice', type: 'multiselect', icon: List },
  { key: 'smart_dropdown', type: 'select', icon: Sparkles, smart: true },
  { key: 'custom_table_selector', type: 'reference', icon: Table, entity: true },
];

/** The icon of a property type on a card and in the library (v3 `fieldTypeIcons`). */
export const TYPE_ICONS: Readonly<Record<PropertyTypeKey, Component>> = {
  text: Type,
  localized_text: Languages,
  number: Hash,
  integer: Hash,
  boolean: SquareCheck,
  date: Calendar,
  datetime: CalendarClock,
  time: Clock,
  select: ChevronDown,
  multiselect: List,
  participant: Users,
  role: Users,
  reference: Link,
  geometry: MapPin,
  file: Upload,
};
