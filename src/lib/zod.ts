import { z } from "zod";

/**
 * The app's one zod instance, configured once. Import `z` from here, not
 * from "zod", so the configuration below is in force before any schema runs.
 *
 * - `jitless`: zod 4 compiles object parsers with `new Function`. The CSP has
 *   no 'unsafe-eval', so the attempt (and the probe for it) would only raise a
 *   securitypolicyviolation on every page.
 * - `customError`: zod 4 reworded its default messages ("Invalid input:
 *   expected string, received undefined"). This keeps the zod 3 wording the
 *   forms show under a field and the RPC-result errors report ("Required",
 *   "String must contain at most 300 character(s)"). A message a schema sets
 *   itself still wins; an issue not listed here gets zod 4's own wording.
 */

const describe = (input: unknown): string => {
  if (input === null) return "null";
  if (Array.isArray(input)) return "array";
  if (Number.isNaN(input)) return "nan";
  return typeof input;
};

const quote = (value: unknown) => (typeof value === "string" ? `'${value}'` : String(value));

const zod3Wording: z.core.$ZodErrorMap = (issue) => {
  switch (issue.code) {
    case "invalid_type": {
      if (issue.input === undefined) return "Required";
      // `.int()` reports a fraction as the wrong type, as zod 3 did.
      if (issue.expected === "int") return "Expected integer, received float";
      return `Expected ${issue.expected}, received ${describe(issue.input)}`;
    }
    case "invalid_value":
      if (issue.values.length === 1) {
        return `Invalid literal value, expected ${JSON.stringify(issue.values[0])}`;
      }
      return `Invalid enum value. Expected ${issue.values.map(quote).join(" | ")}, received ${quote(issue.input)}`;
    case "too_small": {
      const n = String(issue.minimum);
      if (issue.origin === "string") {
        const bound = issue.exact ? "exactly" : issue.inclusive ? "at least" : "over";
        return `String must contain ${bound} ${n} character(s)`;
      }
      if (issue.origin === "array") {
        const bound = issue.exact ? "exactly" : issue.inclusive ? "at least" : "more than";
        return `Array must contain ${bound} ${n} element(s)`;
      }
      if (issue.origin === "number") {
        const bound = issue.exact
          ? "exactly equal to"
          : issue.inclusive
            ? "greater than or equal to"
            : "greater than";
        return `Number must be ${bound} ${n}`;
      }
      return undefined;
    }
    case "too_big": {
      const n = String(issue.maximum);
      if (issue.origin === "string") {
        const bound = issue.exact ? "exactly" : issue.inclusive ? "at most" : "under";
        return `String must contain ${bound} ${n} character(s)`;
      }
      if (issue.origin === "array") {
        const bound = issue.exact ? "exactly" : issue.inclusive ? "at most" : "less than";
        return `Array must contain ${bound} ${n} element(s)`;
      }
      if (issue.origin === "number") {
        const bound = issue.exact
          ? "exactly"
          : issue.inclusive
            ? "less than or equal to"
            : "less than";
        return `Number must be ${bound} ${n}`;
      }
      return undefined;
    }
    case "invalid_format":
      if (issue.format === "regex") return "Invalid";
      if (issue.format === "guid") return "Invalid uuid";
      return `Invalid ${issue.format}`;
    case "invalid_union":
    case "custom":
      return "Invalid input";
    default:
      return undefined;
  }
};

z.config({ jitless: true, customError: zod3Wording });

export { z };
