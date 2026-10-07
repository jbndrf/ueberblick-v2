/** The tile icons of the manifest (`manifest.ts` `icon`), v3's icon set (lucide). An unknown name shows the wrench. */
import type { Component } from 'svelte';
import Bookmark from '@lucide/svelte/icons/bookmark';
import MessageSquare from '@lucide/svelte/icons/message-square';
import Ruler from '@lucide/svelte/icons/ruler';
import Search from '@lucide/svelte/icons/search';
import Wrench from '@lucide/svelte/icons/wrench';

const ICONS: Readonly<Record<string, Component>> = {
  'message-square': MessageSquare,
  ruler: Ruler,
  search: Search,
  bookmark: Bookmark,
};

export const toolIcon = (name: string): Component => ICONS[name] ?? Wrench;
