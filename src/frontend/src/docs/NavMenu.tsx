// The popup of a tab menu or the dropdown switcher (DivisionNav.tsx): a lazy
// chunk, so a site without menus never loads the menu primitive.
import type { ReactElement } from 'react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { DivisionLink } from './navDivisions'

type Props = { trigger: ReactElement; items: DivisionLink[]; render: (link: DivisionLink) => ReactElement; defaultOpen?: boolean }

export default function NavMenu({ trigger, items, render, defaultOpen }: Props) {
    return (
        <DropdownMenu modal={false} defaultOpen={defaultOpen}>
            <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="aiui-docs-menu">
                {items.map((link) => (
                    <DropdownMenuItem key={link.key} asChild>{render(link)}</DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
