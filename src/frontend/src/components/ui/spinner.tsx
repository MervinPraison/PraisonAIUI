import { cva, type VariantProps } from "class-variance-authority"
import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

// The only loading indicator for inline waits (use Skeleton for content
// placeholders). Never render a bare "Loading..." string instead. Under
// prefers-reduced-motion it keeps turning, slowly, because it is the signal.
const spinnerVariants = cva(
  "shrink-0 animate-spin motion-reduce:animate-[spin_1.6s_linear_infinite]",
  {
    variants: {
      size: {
        sm: "size-3.5",
        default: "size-4",
        lg: "size-6",
      },
      tone: {
        current: "",
        muted: "text-muted-foreground",
      },
    },
    defaultVariants: {
      size: "default",
      tone: "current",
    },
  }
)

function Spinner({
  className,
  size,
  tone,
  "aria-label": ariaLabel = "Loading",
  ...props
}: React.ComponentProps<"svg"> & VariantProps<typeof spinnerVariants>) {
  return (
    <Loader2Icon
      role="status"
      aria-label={ariaLabel}
      data-slot="spinner"
      className={cn(spinnerVariants({ size, tone }), className)}
      {...props}
    />
  )
}

export { Spinner, spinnerVariants }
