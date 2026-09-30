"use client";

import { useEffect, useMemo } from "react";
import { ContractUI } from "./ContractUI";
import "@scaffold-ui/debug-contracts/styles.css";
import { useSessionStorage } from "usehooks-ts";
import { useAccount, useSwitchChain } from "wagmi";
import { BarsArrowUpIcon } from "@heroicons/react/20/solid";
import { useTargetNetwork } from "~~/hooks/scaffold-eth";
import scaffoldConfig from "~~/scaffold.config";
import { ContractName, GenericContract, contracts } from "~~/utils/scaffold-eth/contract";
import { useAllContracts } from "~~/utils/scaffold-eth/contractsData";

const selectedContractStorageKey = "scaffoldEth2.selectedContract";

export function DebugContracts() {
  const contractsData = useAllContracts();
  const { targetNetwork } = useTargetNetwork();
  const { isConnected } = useAccount();
  const { switchChain } = useSwitchChain();
  // Networks that do have deployed contracts, so an empty page can say where to look.
  const deployedOn = scaffoldConfig.targetNetworks.filter(
    network => Object.keys((contracts as Record<number, object | undefined>)?.[network.id] ?? {}).length > 0,
  );
  const contractNames = useMemo(
    () =>
      Object.keys(contractsData).sort((a, b) => {
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
      }) as ContractName[],
    [contractsData],
  );

  const [selectedContract, setSelectedContract] = useSessionStorage<ContractName>(
    selectedContractStorageKey,
    contractNames[0],
    { initializeWithValue: false },
  );

  useEffect(() => {
    if (!contractNames.includes(selectedContract)) {
      setSelectedContract(contractNames[0]);
    }
  }, [contractNames, selectedContract, setSelectedContract]);

  return (
    <div className="flex flex-col gap-y-6 lg:gap-y-8 py-8 lg:py-12 justify-center items-center">
      {contractNames.length === 0 ? (
        <div className="mt-14 text-center">
          <p className="text-3xl">No contracts on {targetNetwork.name}</p>
          {deployedOn.length > 0 && (
            <div className="mt-4 flex flex-col items-center gap-3">
              <p>Deployed on {deployedOn.map(network => network.name).join(", ")}.</p>
              {isConnected ? (
                deployedOn.map(network => (
                  <button
                    key={network.id}
                    className="btn btn-primary btn-sm"
                    onClick={() => switchChain({ chainId: network.id })}
                  >
                    Switch to {network.name}
                  </button>
                ))
              ) : (
                <p>Connect a wallet on that network to see and call them.</p>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          {contractNames.length > 1 && (
            <div className="flex flex-row gap-2 w-full max-w-7xl pb-1 px-6 lg:px-10 flex-wrap">
              {contractNames.map(contractName => (
                <button
                  className={`btn btn-secondary btn-sm font-light hover:border-transparent ${
                    contractName === selectedContract
                      ? "bg-base-300 hover:bg-base-300 no-animation"
                      : "bg-base-100 hover:bg-secondary hover:text-secondary-content"
                  }`}
                  key={contractName}
                  onClick={() => setSelectedContract(contractName)}
                >
                  {contractName}
                  {(contractsData[contractName] as GenericContract)?.external && (
                    <span className="tooltip tooltip-top tooltip-accent" data-tip="External contract">
                      <BarsArrowUpIcon className="h-4 w-4 cursor-pointer" />
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          {contractNames.map(
            contractName =>
              contractName === selectedContract && <ContractUI key={contractName} contractName={contractName} />,
          )}
        </>
      )}
    </div>
  );
}
