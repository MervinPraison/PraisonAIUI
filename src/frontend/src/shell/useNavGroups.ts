import { useMemo } from 'react'
import { useNavGroupDeclarations } from '@/sdk/contributions'
import type { ShellManifest } from '@/sdk/manifest'
import { navGroups, withDeclaredGroups, type NavGroupsConfig } from './nav'

/**
 * The sidebar's group config: the manifest's `layout.groups` plus the groups
 * plugins declared (registerNavGroup, a plugin's nav_groups()). The sidebar,
 * the phone menu and the command palette all read it, so they list pages in
 * the same order.
 */
export function useNavGroupsConfig(manifest: Pick<ShellManifest, 'layout'>): NavGroupsConfig {
  const declared = useNavGroupDeclarations()
  return useMemo(() => withDeclaredGroups(navGroups(manifest), declared), [manifest, declared])
}
