/** The icons an admin can put on a task button: the registry `TASK_BUTTON_ICONS` (one entry per icon, checked by the type). An unknown key draws none. */
import type { Component } from 'svelte';
import { TASK_BUTTON_ICONS, type TaskButtonIcon } from '@ueberblick/core/registry';
import Camera from '@lucide/svelte/icons/camera';
import Check from '@lucide/svelte/icons/check';
import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
import Leaf from '@lucide/svelte/icons/leaf';
import MapPin from '@lucide/svelte/icons/map-pin';
import Pencil from '@lucide/svelte/icons/pencil';
import Trash2 from '@lucide/svelte/icons/trash-2';
import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
import Wrench from '@lucide/svelte/icons/wrench';

const ICONS: Readonly<Record<TaskButtonIcon, Component>> = {
  camera: Camera,
  check: Check,
  'clipboard-check': ClipboardCheck,
  leaf: Leaf,
  'map-pin': MapPin,
  pencil: Pencil,
  'trash-2': Trash2,
  'triangle-alert': TriangleAlert,
  wrench: Wrench,
};

export const taskIcon = (key: string): Component | undefined =>
  TASK_BUTTON_ICONS.has(key) ? ICONS[key as TaskButtonIcon] : undefined;
