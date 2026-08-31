import { useId } from "react";
import { Input } from "@/components/ui/input";
import { LEGAL_TAXONOMY_TOPICS } from "@/lib/legal-taxonomy";

interface TagInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

/**
 * Shared "add a tag" input for Docket Matters, Judgments, and Case Law —
 * a plain text field (so any existing free-text tagging behavior is
 * fully preserved) backed by a native `<datalist>` of canonical legal
 * topics from `src/lib/legal-taxonomy.ts`. Browsers surface the
 * matching canonical terms as the user types, but nothing prevents
 * submitting arbitrary custom text — canonical tags are encouraged, not
 * enforced, per Part G ("allow manual tags where genuinely needed but
 * encourage canonical tags"). No new dependency (this codebase already
 * avoids @radix-ui/react-select for the same reason — no npm registry
 * access in this sandbox); the native element carries full keyboard/a11y
 * support for free.
 */
export function TagInput({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder = "Add a tag, pick a suggestion, or type your own…",
  className,
}: TagInputProps) {
  const listId = useId();
  return (
    <>
      <Input
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        aria-label="New tag name"
        className={className}
      />
      <datalist id={listId}>
        {LEGAL_TAXONOMY_TOPICS.map((topic) => (
          <option key={topic} value={topic} />
        ))}
      </datalist>
    </>
  );
}
