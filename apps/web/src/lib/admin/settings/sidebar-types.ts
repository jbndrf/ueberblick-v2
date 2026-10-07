import type { Component } from 'svelte';

/** v3 `SettingsSidebar.svelte`: the status dot of an item (on, off, unavailable) or none. */
export const SIDEBAR_STATUSES = ['on', 'off', 'unavailable', 'none'] as const;
export type SidebarStatus = (typeof SIDEBAR_STATUSES)[number];
export const SIDEBAR_TONES = ['default', 'destructive'] as const;
export type SidebarTone = (typeof SIDEBAR_TONES)[number];

export interface SidebarItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: Component<{ class?: string }>;
  readonly status?: SidebarStatus;
  readonly tone?: SidebarTone;
}

export interface SidebarGroup {
  readonly caption: string;
  readonly items: readonly SidebarItem[];
}
