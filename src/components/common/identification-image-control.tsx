import { useRef } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import { SignedThumb } from "@/components/common/signed-thumb";
import { IDENTIFICATION_IMAGE_ACCEPT } from "@/hooks/docket/use-identification-images";

interface IdentificationImageControlProps {
  path: string | null | undefined;
  alt: string;
  onUpload: (file: File) => void;
  onClear?: () => void;
  isPending?: boolean;
  label: string;
  description?: string;
  readOnly?: boolean;
}

export function IdentificationImageControl({
  path,
  alt,
  onUpload,
  onClear,
  isPending,
  label,
  description,
  readOnly,
}: IdentificationImageControlProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex items-start gap-4">
      <SignedThumb path={path} alt={alt} className="h-24 w-20 shrink-0 rounded-sm" />
      <div className="min-w-0 space-y-2">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && !readOnly && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
        {!readOnly && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept={IDENTIFICATION_IMAGE_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUpload(file);
                e.target.value = "";
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => inputRef.current?.click()}
              >
                {isPending ? (
                  <LoadingSpinner className="text-current" size={14} />
                ) : (
                  <ImagePlus className="h-4 w-4" />
                )}
                {path ? "Replace photo" : "Add photo"}
              </Button>
              {path && onClear && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={onClear}
                >
                  <Trash2 className="h-4 w-4" />
                  Remove
                </Button>
              )}
            </div>
          </>
        )}
        {readOnly && !path && (
          <p className="text-xs text-muted-foreground">No photo attached.</p>
        )}
      </div>
    </div>
  );
}
