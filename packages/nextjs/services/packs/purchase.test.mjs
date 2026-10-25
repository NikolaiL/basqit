import { openWithApproval } from "./purchase.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("an exact or higher allowance skips approval", async () => {
  for (const allowance of [10n, 11n]) {
    let opened = 0;
    await openWithApproval({
      cost: 10n,
      readAllowance: async () => allowance,
      approve: async () => assert.fail("Unnecessary approval"),
      open: async () => ++opened,
      onStep: () => {},
    });
    assert.equal(opened, 1);
  }
});

test("waits for the approval receipt and rereads allowance before opening", async () => {
  let confirm, signing;
  const enteredApproval = new Promise(resolve => {
    signing = resolve;
  });
  const receipt = new Promise(resolve => {
    confirm = resolve;
  });
  const events = [];
  let allowance = 1n;
  const pending = openWithApproval({
    cost: 10n,
    readAllowance: async () => {
      events.push("read");
      return allowance;
    },
    approve: async () => {
      events.push("approve");
      signing();
      await receipt;
      allowance = 10n;
      return "receipt";
    },
    open: async () => {
      events.push("open");
      return "purchase";
    },
    onStep: () => {},
  });
  await enteredApproval;
  assert.deepEqual(events, ["read", "approve"]);
  confirm();
  await pending;
  assert.deepEqual(events, ["read", "approve", "read", "open"]);
});

test("rejected, reverted, missing or ineffective approvals never trigger a purchase", async () => {
  for (const approve of [
    async () => {
      throw new Error("User rejected");
    },
    async () => {
      throw new Error("Transaction reverted");
    },
    async () => undefined,
    async () => "confirmed but still insufficient",
  ]) {
    await assert.rejects(
      openWithApproval({
        cost: 10n,
        readAllowance: async () => 0n,
        approve,
        open: async () => assert.fail("Opened without an active approval"),
        onStep: () => {},
      }),
    );
  }
});

test("read errors or a wallet change stop before purchasing", async () => {
  let reads = 0;
  await assert.rejects(
    openWithApproval({
      cost: 10n,
      readAllowance: async () => {
        if (reads++) throw new Error("Wallet changed");
        return 0n;
      },
      approve: async () => "confirmed",
      open: async () => assert.fail("Opened with another wallet"),
      onStep: () => {},
    }),
    /Wallet changed/,
  );
});

test("invalid totals and failed allowance reads do not request approval", async () => {
  for (const cost of [0n, -1n, 10n]) {
    await assert.rejects(
      openWithApproval({
        cost,
        readAllowance: async () => {
          throw new Error("Read failed");
        },
        approve: async () => assert.fail("Approval requested without a valid total and allowance"),
        open: async () => assert.fail("Purchase requested without an allowance"),
        onStep: () => {},
      }),
    );
  }
});
