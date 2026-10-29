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
// The policy Supabase Auth enforces (password-policy.ts, mirrored from
// supabase/config.toml), shared with registration. Each rule is refused on
// its own, so a server-side relaxation or tightening has to be a conscious
// edit here too.

const parse = (values) => resetPasswordSchema.safeParse(values);
const both = (password) => parse({ password, confirmPassword: password }).success;

check("a valid, matching password passes", both("Good-Pass-2026"), true);
check("exactly 12 characters with every class passes", both("Abcdefgh12#x"), true);
check("11 characters is rejected", both("Abcdefg12#x"), false);
check("the old 8-character policy's example is now rejected", both("GoodPass1"), false);
check("no uppercase is rejected", both("good-pass-2026"), false);
check("no lowercase is rejected", both("GOOD-PASS-2026"), false);
check("no digit is rejected", both("Good-Pass-Word"), false);
check("no symbol is rejected", both("GoodPass2026x"), false);
check("a symbol outside GoTrue's set does not count (pound sign)", both("GoodPass2026£"), false);
check(
  "a mismatched confirmation is rejected",
  parse({ password: "Good-Pass-2026", confirmPassword: "Good-Pass-2027" }).success,
  false,
);
{
  const result = parse({ password: "Good-Pass-2026", confirmPassword: "Good-Pass-2027" });
  check(
    "the mismatch error attaches to confirmPassword, not password",
    result.success ? null : result.error.issues[0]?.path,
    ["confirmPassword"],
  );
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
