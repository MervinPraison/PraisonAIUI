// @praisonaiui/react - UI component library
// Re-exports all shadcn/ui components configured for PraisonAIUI

// Core components
export { Button, buttonVariants } from './ui/button'
export { ScrollArea, ScrollBar } from './ui/scroll-area'
export { Separator } from './ui/separator'

// Layout components
export {
    Card,
    CardHeader,
    CardFooter,
    CardTitle,
    CardDescription,
    CardContent,
} from './ui/card'

export {
    Sheet,
    SheetTrigger,
    SheetClose,
    SheetContent,
    SheetHeader,
    SheetFooter,
    SheetTitle,
    SheetDescription,
} from './ui/sheet'

// Feedback components
export {
    Dialog,
    DialogPortal,
    DialogOverlay,
    DialogTrigger,
    DialogClose,
    DialogContent,
    DialogHeader,
    DialogFooter,
    DialogTitle,
    DialogDescription,
} from './ui/dialog'

export {
    Tooltip,
    TooltipTrigger,
    TooltipContent,
    TooltipProvider,
} from './ui/tooltip'

export { Badge, badgeVariants } from './ui/badge'

// Navigation components
export {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuCheckboxItem,
    DropdownMenuRadioItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuGroup,
    DropdownMenuPortal,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuRadioGroup,
} from './ui/dropdown-menu'

// Avatar
export { Avatar, AvatarImage, AvatarFallback } from './ui/avatar'

// Utility
export { cn } from '../lib/utils'

// Theme utilities
export { applyTheme, SHADCN_THEMES, RADIUS_PRESETS } from '../themes'

// Theme toggle component
export { ThemeToggle } from './theme-toggle'
