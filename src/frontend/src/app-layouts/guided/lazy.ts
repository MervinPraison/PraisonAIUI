/**
 * Loaders of Guided's lazy parts, in one small chunk of this layout. The
 * eager descriptor (builtin/layouts/guided.ts) imports only this module, so
 * the boot chunk carries one dynamic import (and one preload list) instead
 * of one per region and page. Every part below is still its own chunk,
 * fetched only when shown.
 */
export const stepTracker = () => import('@/layout-features/step-tracker/StepTracker')
export const followUps = () => import('./FollowUps')
export const templatesEmpty = () => import('./TemplatesEmpty')
export const startPage = () => import('./StartPage')
export const templatesPage = () => import('./TemplatesPage')
