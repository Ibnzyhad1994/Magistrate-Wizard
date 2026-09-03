// Test-only stand-in for `@/lib/supabase`, used exclusively by the
// at-alias-loader when running scripts/tests/*.mjs under plain Node (see
// at-alias-loader.mjs for why the real module can't load there).
//
// Default property access still throws so accidental network use fails
// loudly. Session-lock tests install a programmable `auth.signOut` /
// `auth.getSession` by calling `installSupabaseAuthMock`.

const unusedClientError = () => {
  throw new Error(
    "supabase stub: this test harness never expects a real Supabase call — " +
      "if you see this, the function under test now depends on the network client " +
      "and needs a real integration test instead.",
  )
}

const authMock = {
  signOut: unusedClientError,
  getSession: unusedClientError,
}

export const getSupabaseAuthMockCalls = () => authMock.calls ?? []

export const installSupabaseAuthMock = (handlers = {}) => {
  const calls = []
  authMock.calls = calls
  authMock.signOut = async (options) => {
    calls.push({ method: "signOut", options })
    if (typeof handlers.signOut === "function") return handlers.signOut(options)
    return { error: null }
  }
  authMock.getSession = async () => {
    calls.push({ method: "getSession" })
    if (typeof handlers.getSession === "function") return handlers.getSession()
    return { data: { session: null }, error: null }
  }
}

export const resetSupabaseAuthMock = () => {
  authMock.calls = []
  authMock.signOut = unusedClientError
  authMock.getSession = unusedClientError
}

export const supabase = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === "auth") return authMock
      unusedClientError()
    },
  },
)
