import { Laptop, Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { setThemePreference, type ThemePreference } from "../themes"

export type ThemeToggleVariant = "switch" | "menu"

interface ThemeToggleProps {
    theme?: ThemePreference
    /** `"switch"` (default): 1-click flip to opposite mode. `"menu"`: 3-option Light / Dark / System dropdown. */
    variant?: ThemeToggleVariant
    onThemeChange?: (theme: ThemePreference) => void
}

export function ThemeToggle({ variant = "switch", onThemeChange }: ThemeToggleProps) {
    const setTheme = (newTheme: ThemePreference) => {
        setThemePreference(newTheme)
        onThemeChange?.(newTheme)
    }

    const icons = (
        <>
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </>
    )

    if (variant !== "menu") {
        const toggle = () => {
            const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark")
            setTheme(isDark ? "light" : "dark")
        }
        return (
            <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Toggle theme"
                data-aiui-theme-toggle="switch"
                onClick={toggle}
            >
                {icons}
            </Button>
        )
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" data-aiui-theme-toggle="menu">
                    {icons}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setTheme("light")}>
                    <Sun className="mr-2 h-4 w-4" />
                    Light
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme("dark")}>
                    <Moon className="mr-2 h-4 w-4" />
                    Dark
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme("system")}>
                    <Laptop className="mr-2 h-4 w-4" />
                    System
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
