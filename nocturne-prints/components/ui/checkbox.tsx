import * as React from "react";
import { cn } from "@/lib/utils";

export const Checkbox = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        "mt-1 h-4 w-4 rounded border-zinc-600 bg-zinc-900 text-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300",
        className,
      )}
      {...props}
    />
  ),
);

Checkbox.displayName = "Checkbox";
