import { useForm, type FieldValues, type UseFormProps, type UseFormReturn } from "react-hook-form";

/**
 * House wrapper over react-hook-form's `useForm`.
 *
 * The one behavioural difference is `mode: "onTouched"`: a field is
 * validated the first time it loses focus and re-validated on every change
 * after that, so a magistrate sees "Case number is required" as they move
 * on, not after they press Save and lose their place in a 580-line dialog.
 * Submit-only validation was the default in every form before this hook
 * existed (0 forms set `mode`).
 *
 * Anything passed in `props` wins, so a form can still opt into
 * `mode: "onSubmit"` where blur-time validation would be noisy (search
 * boxes, optional filters).
 *
 * New forms use this; existing `useForm(` callers are migrated in a
 * separate sweep (list in docs/ui-conventions.md).
 */
export function useAppForm<
  TFieldValues extends FieldValues = FieldValues,
  TContext = unknown,
  TTransformedValues = TFieldValues,
>(
  props?: UseFormProps<TFieldValues, TContext, TTransformedValues>,
): UseFormReturn<TFieldValues, TContext, TTransformedValues> {
  return useForm<TFieldValues, TContext, TTransformedValues>({
    mode: "onTouched",
    ...props,
  });
}
