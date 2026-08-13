import { User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSignedUrls } from "@/hooks/use-signed-urls";

interface SignedThumbProps {
  path: string | null | undefined;
  alt: string;
  className?: string;
}

/** Private-bucket thumbnail. Falls back to a person mark when no photo. */
export function SignedThumb({ path, alt, className }: SignedThumbProps) {
  const { data } = useSignedUrls([path]);
  const url = path ? data?.[path] : undefined;

  if (!url) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center bg-muted text-muted-foreground",
          className,
        )}
        aria-hidden="true"
      >
        <User className="h-1/2 w-1/2" strokeWidth={1.5} />
      </span>
    );
  }

  return <img src={url} alt={alt} className={cn("object-cover", className)} />;
}
