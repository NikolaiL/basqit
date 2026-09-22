import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Exercise the actual provider effects with mocked wallet/session boundaries.
const code = ts.transpileModule(
  readFileSync(new URL("../../components/WalletAuthentication.tsx", import.meta.url), "utf8"),
  {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  },
).outputText;
function setup({ signedIn = false, pending = false } = {}) {
  const state = {
    account: { address: "0x1111111111111111111111111111111111111111", chainId: 1, status: "connected" },
    session: {
      isSuccess: !pending,
      isPending: pending,
      data: { address: signedIn ? "0x1111111111111111111111111111111111111111" : null },
    },
    prompts: 0,
    verifies: 0,
    notices: 0,
  };
  let settle,
    index = 0,
    effects = [],
    dirty = false;
  const slots = [];
  const client = {
    setQueryData: (_key, data) => {
      state.session.data = data;
      dirty = true;
    },
  };
  const modules = {
    react: {
      useState(initial) {
        const i = index++;
        if (!(i in slots)) slots[i] = initial;
        return [
          slots[i],
          value => {
            if (slots[i] !== value) {
              slots[i] = value;
              dirty = true;
            }
          },
        ];
      },
      useRef(initial) {
        const i = index++;
        return (slots[i] ??= { current: initial });
      },
      useMemo(fn) {
        const i = index++;
        return (slots[i] ??= fn());
      },
      useEffect(fn, deps) {
        const i = index++;
        if (!slots[i] || deps.some((v, j) => v !== slots[i][j])) {
          slots[i] = deps;
          effects.push(fn);
        }
      },
    },
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }) },
    "@rainbow-me/rainbowkit": { createAuthenticationAdapter: x => x, RainbowKitAuthenticationProvider: "auth" },
    "@tanstack/react-query": { useQuery: () => state.session, useQueryClient: () => client },
    "viem/siwe": { createSiweMessage: ({ address }) => address },
    wagmi: {
      useAccount: () => state.account,
      useConfig: () => client,
      useSignMessage: () => ({
        signMessageAsync: () => {
          state.prompts++;
          return new Promise((resolve, reject) => {
            settle = { resolve, reject };
          });
        },
      }),
    },
    "wagmi/actions": { getAccount: () => state.account },
    "~~/utils/scaffold-eth": { notification: { error: () => state.notices++ } },
  };
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    require: name => {
      assert.ok(modules[name], name);
      return modules[name];
    },
    window: { location: { host: "basqit.test", origin: "https://basqit.test" } },
    fetch: async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.action === "verify") state.verifies++;
      return { ok: true, json: async () => (body.action === "nonce" ? { nonce: "nonce" } : { address: body.message }) };
    },
  });
  const render = () => {
    do {
      dirty = false;
      index = 0;
      effects = [];
      state.tree = exports.WalletAuthentication({ children: null });
      effects.forEach(effect => effect());
    } while (dirty);
  };
  return {
    state,
    render,
    flush: async () => {
      await new Promise(resolve => setImmediate(resolve));
      render();
    },
    settle: () => settle,
  };
}
const ready = setup();
ready.render();
await ready.flush();
assert.equal(ready.state.prompts, 1, "connected wallet requests signature automatically");
assert.equal(ready.state.tree.props.status, "loading");
ready.render();
assert.equal(ready.state.prompts, 1, "rerenders do not duplicate prompts");
ready.settle().resolve("signature");
await ready.flush();
assert.equal(ready.state.verifies, 1);
assert.equal(ready.state.tree.props.status, "authenticated");
const rejected = setup();
rejected.render();
await rejected.flush();
rejected.settle().reject(new Error("User rejected"));
await rejected.flush();
rejected.render();
await rejected.flush();
assert.equal(rejected.state.prompts, 1, "cancellation does not loop");
assert.equal(rejected.state.tree.props.status, "unauthenticated", "manual sign-in remains available");
const restored = setup({ signedIn: true });
restored.render();
await restored.flush();
assert.equal(restored.state.prompts, 0, "valid sessions need no signature");
const checking = setup({ pending: true });
checking.render();
await checking.flush();
assert.equal(checking.state.prompts, 0, "wait for session lookup");
const changed = setup();
changed.render();
await changed.flush();
changed.state.account = { status: "disconnected" };
changed.render();
changed.settle().resolve("old-signature");
await changed.flush();
assert.equal(changed.state.verifies, 0, "ignore signatures after disconnect");
console.log(
  "Wallet auto-sign: success, cancellation, duplicate prevention, existing sessions, lookup and disconnect passed",
);

const buttonCode = ts.transpileModule(
  readFileSync(
    new URL("../../components/scaffold-eth/RainbowKitCustomConnectButton/index.tsx", import.meta.url),
    "utf8",
  ),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
).outputText;
const buttonExports = {};
vm.runInNewContext(buttonCode, {
  exports: buttonExports,
  require: name => {
    if (name === "react/jsx-runtime") return { jsx: (_type, props) => props, jsxs: (_type, props) => props };
    if (name === "@rainbow-me/rainbowkit") return { ConnectButton: { Custom: "connect" } };
    if (name === "@scaffold-ui/hooks") return { getBlockExplorerAddressLink: () => "" };
    if (name.endsWith("useTargetNetwork")) return { useTargetNetwork: () => ({ targetNetwork: { id: 1 } }) };
    return {};
  },
});
const button = buttonExports.RainbowKitCustomConnectButton().children;
const label = params => button({ mounted: true, ...params }).children.children;
assert.equal(label({ account: undefined }), "Connect Wallet");
assert.equal(
  label({ account: { address: "0x1" }, authenticationStatus: "unauthenticated" }),
  "Sign in",
  "account without chain metadata is already connected",
);
assert.equal(label({ account: { address: "0x1" }, authenticationStatus: "loading" }), "Confirm in wallet…");
console.log("Wallet button: disconnected, signature needed and signature pending labels passed");
