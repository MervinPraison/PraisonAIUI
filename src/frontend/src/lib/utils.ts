import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * tailwind-merge that knows the theme's own scale values (styles/theme.css
 * @theme): `shadow-float` / `shadow-overlay` are shadows (not shadow
 * colours) and `max-w-reading` is a max-width, so a later one replaces an
 * earlier `shadow-lg` / `max-w-full` instead of both staying in the class list.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      shadow: ["float", "overlay"],
      container: ["reading"],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
