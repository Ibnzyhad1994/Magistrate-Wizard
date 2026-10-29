/**
 * The password policy Supabase Auth enforces (supabase/config.toml
 * `minimum_password_length` and `password_requirements =
 * "lower_upper_letters_digits_symbols"`, BE-25), mirrored so a form can say
 * what is wrong before the server refuses it. The server is the authority;
 * `npm run test:password-policy` fails when the two drift apart.
 */

export const PASSWORD_MIN_LENGTH = 12;

/**
 * GoTrue's symbol set for `lower_upper_letters_digits_symbols`, exactly as
 * the Supabase CLI hands it to Auth. A character outside it (an accented
 * letter, a space, a pound sign) is allowed but does not count as a symbol.
 */
export const PASSWORD_SYMBOLS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~";

export type PasswordRule = { message: string; test: (password: string) => boolean };

export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
    test: (password) => password.length >= PASSWORD_MIN_LENGTH,
  },
  {
    message: "Password must contain an uppercase letter",
    test: (password) => /[A-Z]/.test(password),
  },
  {
    message: "Password must contain a lowercase letter",
    test: (password) => /[a-z]/.test(password),
  },
  {
    message: "Password must contain a number",
    test: (password) => /[0-9]/.test(password),
  },
  {
    message: "Password must contain a symbol, such as ! ? # or -",
    test: (password) => [...password].some((char) => PASSWORD_SYMBOLS.includes(char)),
  },
];
