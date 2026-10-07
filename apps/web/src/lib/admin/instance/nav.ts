/**
 * The sidebar's global menu (v3 `globalMenuItems`, `admin/+layout.svelte:273-283`, rendered `:568-586`): items that
 * belong to no project. v3 had the instance settings only, shown to the instance owner. v4 admin accounts have no
 * owner flag and the instance API takes any admin (WP-638), so every admin gets the item.
 */
import type { NavItem } from '../../../routes/(admin)/admin/shell/nav';

export const GLOBAL_ITEMS: readonly NavItem[] = [
  { key: 'instance', href: '/admin/instance', icon: 'settings', label: 'nav_instance' },
];
