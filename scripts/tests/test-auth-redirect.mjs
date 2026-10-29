/**
 * BE-27: the pure pieces of the PKCE email-link flow (src/lib/auth/auth-redirect.ts):
 * where an Auth email returns to on each shell, which deep links may load a
 * page, which URLs carry an Auth return (and Google Calendar's ?code= does
 * not), that every Auth parameter is cleared from the address bar, and that
 * a recovery session is told apart from a sign-in by its token.
 *
 *   npm run test:auth-redirect
 */
import {
  authRedirectUrl,
  inAppPathFromAuthDeepLink,
  isRecoveryAccessToken,
  readAuthCallback,
  urlWithoutAuthCallback,
} from "../../src/lib/auth/auth-redirect.ts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let failures = 0;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}`);
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected));
    console.log("  actual:  ", JSON.stringify(actual));
    failures += 1;
  }
}

const at = (href) => {
  const url = new URL(href, "https://app.example.test");
  return { pathname: url.pathname, search: url.search, hash: url.hash };
};

// --- authRedirectUrl ---------------------------------------------------------

check(
  "web returns to its own origin",
  authRedirectUrl("/reset-password", { native: false, origin: "https://app.example.test" }),
  "https://app.example.test/reset-password",
);
check(
  "a native shell returns through the app scheme",
  authRedirectUrl("/reset-password", { native: true, origin: "https://localhost" }),
  "magistratewizard://auth/reset-password",
);

// --- inAppPathFromAuthDeepLink -----------------------------------------------

check(
  "a reset deep link maps to the in-app reset page with its query",
  inAppPathFromAuthDeepLink("magistratewizard://auth/reset-password?code=abc&sb_flow_id=f1"),
  "/reset-password?code=abc&sb_flow_id=f1",
);
check(
  "a signup confirmation deep link maps to the login page",
  inAppPathFromAuthDeepLink("magistratewizard://auth/login?code=abc"),
  "/login?code=abc",
);
check(
  "Google Calendar's oauth host is not an Auth return",
  inAppPathFromAuthDeepLink("magistratewizard://oauth/google/callback?code=abc"),
  null,
);
check(
  "an Auth-host link to any other page is refused",
  inAppPathFromAuthDeepLink("magistratewizard://auth/admin/people?code=abc"),
  null,
);
check(
  "another scheme is refused",
  inAppPathFromAuthDeepLink("https://auth/reset-password?code=abc"),
  null,
);
check("garbage is refused", inAppPathFromAuthDeepLink("not a url"), null);

// --- readAuthCallback --------------------------------------------------------

check(
  "a PKCE return on the reset page is a code, with its flow id",
  readAuthCallback(at("/reset-password?code=abc&sb_flow_id=f1")),
  { kind: "code", code: "abc", flowId: "f1" },
);
check("a PKCE return without a flow id still reads", readAuthCallback(at("/login?code=abc")), {
  kind: "code",
  code: "abc",
  flowId: null,
});
check(
  "Google Calendar's ?code= on Settings is not an Auth return",
  readAuthCallback(at("/settings?code=abc&state=s")),
  null,
);
check(
  "an Auth error in the query is reported",
  readAuthCallback(
    at(
      "/reset-password?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    ),
  ),
  { kind: "error", message: "Email link is invalid or has expired" },
);
check(
  "an Auth error in the fragment is reported",
  readAuthCallback(at("/login#error=access_denied&error_description=Link+expired")),
  { kind: "error", message: "Link expired" },
);
check(
  "an old implicit-flow link is refused, its tokens never used",
  readAuthCallback(at("/reset-password#access_token=eyJ.x.y&refresh_token=r&type=recovery")).kind,
  "error",
);
check("a plain visit is not a callback", readAuthCallback(at("/reset-password")), null);

// --- urlWithoutAuthCallback --------------------------------------------------

check(
  "the code and flow id are cleared",
  urlWithoutAuthCallback(at("/reset-password?code=abc&sb_flow_id=f1")),
  "/reset-password",
);
check(
  "implicit tokens in the fragment are cleared",
  urlWithoutAuthCallback(
    at(
      "/reset-password#access_token=eyJ.x.y&refresh_token=r&expires_in=3600&token_type=bearer&type=recovery",
    ),
  ),
  "/reset-password",
);
check(
  "error parameters are cleared and unrelated ones kept",
  urlWithoutAuthCallback(at("/login?error=x&error_code=y&error_description=z&lang=en")),
  "/login?lang=en",
);

// --- isRecoveryAccessToken ---------------------------------------------------

const jwt = (claims) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

check(
  "a recovery session (amr recovery) is spotted",
  isRecoveryAccessToken(jwt({ amr: [{ method: "recovery", timestamp: 1 }] })),
  true,
);
check(
  "a password sign-in is not a recovery session",
  isRecoveryAccessToken(jwt({ amr: [{ method: "password", timestamp: 1 }] })),
  false,
);
check("a string-form amr is read too", isRecoveryAccessToken(jwt({ amr: ["recovery"] })), true);
check(
  "a name outside Latin-1 in the claims does not break decoding",
  isRecoveryAccessToken(
    jwt({ user_metadata: { full_name: "Zoë Ñandú 李" }, amr: [{ method: "recovery" }] }),
  ),
  true,
);
check("a token without amr is not a recovery session", isRecoveryAccessToken(jwt({})), false);
check("a malformed token is not a recovery session", isRecoveryAccessToken("nope"), false);

// --- wiring ------------------------------------------------------------------
// The client must use PKCE and leave URL handling to AuthProvider.

const supabaseClient = readFileSync(join(__dirname, "../../src/lib/supabase.ts"), "utf8");
check("the client uses the PKCE flow", supabaseClient.includes('flowType: "pkce"'), true);
check(
  "the client does not scan the URL itself",
  supabaseClient.includes("detectSessionInUrl: false"),
  true,
);
const manifest = readFileSync(
  join(__dirname, "../../android/app/src/main/AndroidManifest.xml"),
  "utf8",
);
check(
  "Android opens magistratewizard://auth links in the app",
  manifest.includes('<data android:scheme="magistratewizard" android:host="auth" />'),
  true,
);
const config = readFileSync(join(__dirname, "../../supabase/config.toml"), "utf8");
check(
  "the local Auth allow-list accepts the app-scheme return",
  config.includes('"magistratewizard://auth/**"'),
  true,
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
