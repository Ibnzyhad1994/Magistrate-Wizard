/**
 * Security-audit fix: the password reset flow used to sign the user back
 * in from the recovery link without ever asking for a new password. These
 * cover the two pure pieces of that fix: detecting a recovery-link
 * landing (so AuthProvider never promotes it to a real sign-in) and the
 * new-password validation ResetPasswordPage enforces.
 *
 *   npm run test:password-reset
 */
import { isPasswordRecoveryUrl } from "../../src/lib/auth/session-policy.ts";
import { resetPasswordSchema } from "../../src/lib/validations/auth.ts";

let failures = 0;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}`);
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected));
    console.log("  actual:  ", JSON.stringify(actual));
    failures += 1;
  }
}

// --- isPasswordRecoveryUrl --------------------------------------------------
// Confirmed empirically against a real recovery email from this app's
// configured (implicit) flow: type=recovery lands in the hash fragment.

check(
  "a real recovery hash is detected",
  isPasswordRecoveryUrl(
    "#access_token=eyJ...&refresh_token=abc&expires_at=1&expires_in=3600&token_type=bearer&type=recovery",
    "",
  ),
  true,
);
check(
  "type=recovery in the query string is also detected (PKCE flow, if ever enabled)",
  isPasswordRecoveryUrl("", "?code=abc&type=recovery"),
  true,
);
check("an ordinary sign-in has neither and is not detected", isPasswordRecoveryUrl("", ""), false);
check(
  "an email-confirmation hash (type=signup) is not mistaken for recovery",
  isPasswordRecoveryUrl("#access_token=eyJ...&type=signup", ""),
  false,
);

// --- resetPasswordSchema ----------------------------------------------------
// Same password policy as registration (registerSchema) -- kept in sync
// deliberately, checked here rather than by import so a policy change in
// one is forced to be a conscious decision about the other, not a
// same-file edit that silently drags both along.

const parse = (values) => resetPasswordSchema.safeParse(values);

check(
  "a valid, matching password passes",
  parse({ password: "GoodPass1", confirmPassword: "GoodPass1" }).success,
  true,
);
check(
  "too short is rejected",
  parse({ password: "Pass1", confirmPassword: "Pass1" }).success,
  false,
);
check(
  "no uppercase is rejected",
  parse({ password: "goodpass1", confirmPassword: "goodpass1" }).success,
  false,
);
check(
  "no lowercase is rejected",
  parse({ password: "GOODPASS1", confirmPassword: "GOODPASS1" }).success,
  false,
);
check(
  "no digit is rejected",
  parse({ password: "GoodPassword", confirmPassword: "GoodPassword" }).success,
  false,
);
check(
  "a mismatched confirmation is rejected",
  parse({ password: "GoodPass1", confirmPassword: "GoodPass2" }).success,
  false,
);
{
  const result = parse({ password: "GoodPass1", confirmPassword: "GoodPass2" });
  check(
    "the mismatch error attaches to confirmPassword, not password",
    result.success ? null : result.error.issues[0]?.path,
    ["confirmPassword"],
  );
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
