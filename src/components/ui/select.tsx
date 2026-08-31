import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Themed select. Native `<select>` popups on Windows follow the OS chrome
 * (white list, light-blue hover) and ignore CSS, so this keeps the same
 * `<option>` children API but renders a DropdownMenu we can style.
 */
export type SelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size">;

type OptionItem = { value: string; label: string; disabled: boolean };

function childText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(childText).join("");
  if (React.isValidElement(node)) {
    return childText((node.props as { children?: React.ReactNode }).children);
  }
  return "";
}

function optionsFromChildren(children: React.ReactNode): OptionItem[] {
  const items: OptionItem[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child) || child.type !== "option") return;
    const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement>;
    items.push({
      value: String(props.value ?? childText(props.children)),
      label: childText(props.children),
      disabled: Boolean(props.disabled),
    });
  });
  return items;
}

const Select = React.forwardRef<HTMLButtonElement, SelectProps>(
  (
    {
      className,
      children,
      value,
      defaultValue,
      onChange,
      onBlur,
      disabled,
      name,
      id,
      required,
      "aria-label": ariaLabel,
      "aria-invalid": ariaInvalid,
      "aria-describedby": ariaDescribedBy,
    },
    ref,
  ) => {
    const options = React.useMemo(() => optionsFromChildren(children), [children]);
    const isControlled = value !== undefined;
    const [internal, setInternal] = React.useState(String(defaultValue ?? ""));
    const current = isControlled ? String(value) : internal;
    const selected = options.find((opt) => opt.value === current) ?? options[0];
    const isPlaceholder = !current || selected?.value === "";

    function emit(next: string) {
      if (!isControlled) setInternal(next);
      onChange?.({
        target: { value: next, name: name ?? "" },
        currentTarget: { value: next, name: name ?? "" },
      } as React.ChangeEvent<HTMLSelectElement>);
    }

    return (
      <>
        {name ? <input type="hidden" name={name} value={current} required={required} /> : null}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              ref={ref}
              type="button"
              id={id}
              disabled={disabled}
              aria-label={ariaLabel}
              aria-invalid={ariaInvalid}
              aria-describedby={ariaDescribedBy}
              aria-required={required}
              onBlur={onBlur as React.FocusEventHandler<HTMLButtonElement> | undefined}
              className={cn(
                "relative flex h-9 w-full items-center rounded-md border border-input bg-transparent px-3 py-1 pr-8 text-left text-sm shadow-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                "disabled:cursor-not-allowed disabled:opacity-50",
                isPlaceholder ? "text-muted-foreground" : "text-foreground",
                className,
              )}
            >
              <span className="truncate">{selected?.label || "Select…"}</span>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="pointer-events-auto z-[70] max-h-60 w-[var(--radix-dropdown-menu-trigger-width)] min-w-[12rem] overflow-y-auto border-white/10 bg-[#181818] p-1 text-white"
          >
            {options.map((opt, index) => (
              <DropdownMenuItem
                key={opt.value || `__empty-${index}`}
                disabled={opt.disabled}
                onSelect={() => emit(opt.value)}
                className={cn(
                  "cursor-pointer",
                  opt.value === current && "bg-white/10",
                  !opt.value && "text-white/55",
                )}
              >
                {opt.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </>
    );
  },
);
Select.displayName = "Select";

export { Select };
