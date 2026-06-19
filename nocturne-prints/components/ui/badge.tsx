import { cn } from "@/lib/utils";

export function Badge({
  children,
  className,
}: Readonly<{
  children: React.ReactNode;
  className?: string;
}>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300",
        className,
      )}
    >
      {children}
    </span>
  );
}
