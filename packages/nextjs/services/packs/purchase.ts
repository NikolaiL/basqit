export async function openWithApproval({
  cost,
  readAllowance,
  approve,
  open,
  onStep,
}: {
  cost: bigint;
  readAllowance: () => Promise<bigint>;
  approve: () => Promise<unknown>;
  open: () => Promise<unknown>;
  onStep: (step: string) => void;
}) {
  if (cost <= 0n) throw new Error("Invalid pack total.");
  onStep("Checking approval…");
  if ((await readAllowance()) < cost) {
    onStep("Approving tUSDG…");
    // The Scaffold writer resolves only after a successful receipt.
    if (!(await approve())) throw new Error("Approval was not submitted.");
    onStep("Checking confirmed approval…");
    if ((await readAllowance()) < cost) throw new Error("Approval is not active yet. Please try again.");
  }
  onStep("Opening…");
  if (!(await open())) throw new Error("Pack opening was not submitted.");
}
