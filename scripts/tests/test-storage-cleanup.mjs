/**
 * The delete hooks ask the storage-cleanup Edge Function to remove a
 * deleted record's files (0165), without ever letting that request fail or
 * delay the delete itself.
 *
 *   npm run test:storage-cleanup
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STORAGE_CLEANUP_FUNCTION,
  deleteThenCleanStorage,
  requestStorageCleanup,
} from "../../src/lib/storage-cleanup.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

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

function fakeClient(result) {
  const calls = [];
  return {
    calls,
    functions: {
      invoke: async (name, options) => {
        calls.push({ name, method: options?.method });
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
}

const quietly = async (run) => {
  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.map(String).join(" "));
  try {
    await run();
  } finally {
    console.error = original;
  }
  return logged;
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// requestStorageCleanup
{
  const client = fakeClient({ data: { removed: 1 }, error: null });
  await requestStorageCleanup(client);
  check("asks the storage-cleanup function with a POST", client.calls, [
    { name: STORAGE_CLEANUP_FUNCTION, method: "POST" },
  ]);
  check("the function name matches its folder", STORAGE_CLEANUP_FUNCTION, "storage-cleanup");
}
{
  const client = fakeClient({ data: null, error: new Error("FunctionsFetchError") });
  let threw = false;
  const logged = await quietly(async () => {
    try {
      await requestStorageCleanup(client);
    } catch {
      threw = true;
    }
  });
  check("a function error does not throw", threw, false);
  check("a function error is logged as still queued", /stay queued/.test(logged.join("")), true);
}
{
  const client = fakeClient(new Error("network down"));
  let threw = false;
  const logged = await quietly(async () => {
    try {
      await requestStorageCleanup(client);
    } catch {
      threw = true;
    }
  });
  check("a network failure does not throw", threw, false);
  check("a network failure is logged", logged.length, 1);
}

// deleteThenCleanStorage
{
  const client = fakeClient({ data: null, error: null });
  const order = [];
  await deleteThenCleanStorage(client, async () => {
    order.push("delete");
    return { error: null };
  });
  await settle();
  check("a successful delete runs the delete", order, ["delete"]);
  check("a successful delete requests cleanup once", client.calls.length, 1);
}
{
  const client = fakeClient({ data: null, error: null });
  const deleteError = { code: "42501", message: "new row violates row-level security policy" };
  let thrown = null;
  try {
    await deleteThenCleanStorage(client, async () => ({ error: deleteError }));
  } catch (err) {
    thrown = err;
  }
  await settle();
  check("a failed delete throws its own error unchanged", thrown, deleteError);
  check("a failed delete requests no cleanup", client.calls.length, 0);
}
{
  const client = fakeClient(new Error("network down"));
  let threw = false;
  await quietly(async () => {
    try {
      await deleteThenCleanStorage(client, async () => ({ error: null }));
      await settle();
    } catch {
      threw = true;
    }
  });
  check("a cleanup failure never fails the delete", threw, false);
}
{
  let resolveInvoke;
  const client = {
    functions: {
      invoke: () =>
        new Promise((resolve) => {
          resolveInvoke = resolve;
        }),
    },
  };
  let finished = false;
  await deleteThenCleanStorage(client, async () => ({ error: null })).then(() => {
    finished = true;
  });
  check("the delete resolves without waiting for the cleanup run", finished, true);
  resolveInvoke({ data: null, error: null });
}

// The hooks that delete a parent with attachments all go through the helper.
const hookFiles = {
  "src/hooks/judgments/use-judgments.ts": 'from("judgments").delete()',
  "src/hooks/bench-notes/use-bench-notes.ts": 'from("bench_notes").delete()',
  "src/hooks/quick-codes/use-quick-codes.ts": 'from("quick_codes").delete()',
  "src/hooks/case-law/use-case-law.ts":
    'deleteThenCleanStorage(supabase, () => supabase.from("case_law").delete()',
  "src/hooks/docket/use-docket-matters.ts": 'rpc("purge_docket_matter"',
};
for (const [file, deleteCall] of Object.entries(hookFiles)) {
  const source = readFileSync(join(ROOT, file), "utf8");
  const at = source.indexOf(deleteCall);
  const wrapped = at >= 0 && source.lastIndexOf("deleteThenCleanStorage(supabase", at) > at - 200;
  check(`${file} deletes through deleteThenCleanStorage`, wrapped, true);
}
{
  const source = readFileSync(join(ROOT, "src/hooks/use-documents.ts"), "utf8");
  const deleteRow = source.indexOf('from("documents").delete()');
  const cleanup = source.indexOf("requestStorageCleanup(supabase)");
  check(
    "useDeleteDocument requests cleanup after the row delete",
    deleteRow > 0 && cleanup > deleteRow,
    true,
  );
}

process.exit(failures > 0 ? 1 : 0);
