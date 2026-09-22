import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

let pending, busy, stateIndex, portals, effects;
const exports = {};
const jsx = (type, props) => ({ type, props });
const code = ts.transpileModule(
  readFileSync(new URL("../../components/trading/FundingPanel.tsx", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
).outputText;
const dependencies = {
  react: {
    useState: initial => {
      const index = stateIndex++;
      return [index === 2 ? true : index === 6 ? busy : initial, () => {}];
    },
    useEffect: effect => effects.push(effect),
    useRef: () => ({ current: null }),
    useId: () => "funding",
  },
  "react/jsx-runtime": { jsx, jsxs: jsx },
  "react-dom": {
    createPortal: content => {
      portals++;
      return content;
    },
  },
  "@tanstack/react-query": {
    useQuery: options => ({ data: options.queryKey[0].startsWith("basqit-funding") ? pending : undefined }),
    useQueryClient: () => ({}),
    useInfiniteQuery: () => ({}),
  },
  wagmi: {
    useAccount: () => ({ address: "0x1111111111111111111111111111111111111111" }),
    useSwitchChain: () => ({}),
  },
  viem: { isAddress: () => true },
  "~~/components/WalletAuthentication": { useWalletSession: () => ({ authenticated: true }) },
  "~~/hooks/scaffold-eth/useFundingTransfer": { useFundingTransfer: () => ({}) },
  "~~/hooks/scaffold-eth/useWalletConnectModal": { useWalletConnectModal: () => ({}) },
  "~~/services/funding/shared": {
    fundingDestinations: { ETH: { decimals: 18 }, USDG: { decimals: 6 } },
    fundingChains: [],
    fundingTokens: () => [],
    terminalStatus: () => false,
    fundingStatusLabel: () => "In progress",
  },
};
vm.runInNewContext(code, {
  exports,
  URLSearchParams,
  document: { body: {} },
  require: name => dependencies[name] ?? {},
});
for (const destination of ["ETH", "USDG"]) {
  for (const [name, record, working, expected] of [
    ["normal converter", null, "", 1],
    ["wallet confirmation hides recovery", { quoteId: "0x1" }, "Confirm in your wallet…", 0],
    ["submitted transfer shows tracking", { quoteId: "0x1", hash: "0x123" }, "Confirm in your wallet…", 1],
    ["interrupted send keeps recovery", { quoteId: "0x1" }, "", 1],
  ]) {
    pending = record;
    busy = working;
    stateIndex = 0;
    portals = 0;
    effects = [];
    const visibility = [];
    const panel = exports.FundingPanel({ destination, onOpenChange: open => visibility.push(open) });
    panel.type(panel.props);
    const cleanup = effects[0]();
    effects[1]();
    assert.equal(
      visibility.at(-1),
      true,
      "parent remains suspended, including while wallet confirmation hides funding",
    );
    cleanup();
    assert.equal(visibility.at(-1), false, "restore parent on funding unmount");
    assert.equal(portals, expected, `${destination}: ${name}`);
    assert.equal(pending, record, "visibility must not discard the saved transfer");
  }
}
console.log("Funding dialog: wallet confirmation hidden; tracking and interrupted-send recovery preserved.");
