/**
 * The layout kit (ADR 0003 R17): pieces every layout frame shares, emitted as
 * one lazy chunk (`layout-kit`) that loads only with a layout. A frame imports
 * shared pieces from here and never copies them; a layout never imports
 * another layout.
 *
 * The kit, like the frames, imports only `@/sdk/*`, `@/components/ui/*`,
 * `@/lib/*` and itself (app-layouts/isolation.test.ts).
 */
export { ApprovalCard, type ApprovalCardProps } from './ApprovalCard'
export { BasicFrame, type BasicFrameProps } from './BasicFrame'
export { Brand } from './Brand'
export { ConnectionStatus, useOnline } from './ConnectionStatus'
export { describeCall, relativeTime } from './format'
export { NavList, NavSection, type NavListProps } from './NavList'
export { iconForNavItem, NavIcon } from './pageIcons'
export { PhoneSheet, type PhoneSheetProps } from './PhoneSheet'
export { preloadPhoneSheet } from './phoneSheetLoader'
export { PhoneTabs, type PhoneTab } from './PhoneTabs'
export { isPlainLeftClick, navRowClass, type KitSize } from './rows'
export { SessionList, type SessionListProps } from './SessionList'
export { ShortcutHint } from './ShortcutHint'
export { useApprovals, useChat } from './useFeeds'
export { useSessions } from './useSessions'
export { isMacPlatform, isTypingTarget, matchesShortcut, parseShortcut, shortcutLabels, useShortcut, type Shortcut, type ShortcutOptions } from './useShortcut'
