import { isAddressEqual, parseAbi, zeroAddress, type Address } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { proveReserve } from "./deploy.ts";
import type { Arm, Network } from "./network.ts";

const directoryAbi = parseAbi(["function registryOf(address) view returns (address)"]);

// A test-token deployment drill, not a permanent role-rotation command. The
// existing reserve key temporarily accepts each role, then hands it back.
export async function exerciseOperations(network: Network, arm: Arm) {
  const { company, auditor, record, client } = network;
  const temporary = network.reserves[arm];
  const registry = network.registryOf(arm);
  const abi = network.abiOf(arm);
  const send = (account: PrivateKeyAccount, name: string, args: unknown[] = []) =>
    network.send(account, registry, abi, name, args);
  const read = <T>(name: string, args: unknown[] = []) => network.read<T>(arm, name, args);
  const holder = () => client.readContract({ address: record.contracts.ReserveDirectory, abi: directoryAbi, functionName: "registryOf", args: [temporary.address] });
  const progress = record.operations ??= {};
  const start = progress[arm] ?? 0;
  if (start === 14) { console.log(`${arm}: operations exercise already complete`); return; }
  if (!Number.isInteger(start) || start < 0 || start > 14) throw new Error(`${arm}: invalid operations checkpoint`);
  for (const [role, original] of [["company", company], ["auditor", auditor]] as const) {
    const current = await read<Address>(role);
    if (![original, temporary].some(account => isAddressEqual(account.address, current))) {
      throw new Error(`${arm}: unexpected ${role}; refusing to exercise roles`);
    }
  }
  if (start === 0 && await read<number>("reserveStatus", [temporary.address]) !== 3) {
    throw new Error(`${arm}: deploy and approve the reserve before exercising operations`);
  }
  progress[arm] = start;
  network.save();
  // Four transactions are sent by the temporary holder. Re-evaluate on resume
  // so a fee spike or an exhausted temporary wallet can be recovered.
  const fees = await client.estimateFeesPerGas();
  const required = (fees.maxFeePerGas ?? fees.gasPrice ?? 0n) * 200_000n;
  const balance = await client.getBalance({ address: temporary.address });
  network.setStep(`${arm} operations funding`);
  if (balance < required) await network.transfer(temporary.address, required - balance);

  async function nominate(role: "company" | "auditor", from: PrivateKeyAccount, to: PrivateKeyAccount) {
    const capital = role === "company" ? "Company" : "Auditor";
    if (isAddressEqual(await read<Address>(role), to.address)) return;
    if (!isAddressEqual(await read<Address>(role), from.address)) throw new Error(`${arm}: unexpected ${role}`);
    const pending = await read<Address>(`pending${capital}`);
    if (isAddressEqual(pending, to.address)) return;
    if (!isAddressEqual(pending, zeroAddress)) throw new Error(`${arm}: another ${role} transfer is pending`);
    await send(from, `transfer${capital}`, [to.address]);
  }
  async function accept(role: "company" | "auditor", to: PrivateKeyAccount) {
    if (!isAddressEqual(await read<Address>(role), to.address)) {
      await send(to, role === "company" ? "acceptCompany" : "acceptAuditor");
    }
    if (!isAddressEqual(await read<Address>(role), to.address)) throw new Error(`${arm}: ${role} acceptance failed`);
  }
  const stages = [
    () => nominate("company", company, temporary),
    () => accept("company", temporary),
    () => nominate("company", temporary, company),
    () => accept("company", company),
    () => nominate("auditor", auditor, temporary),
    () => accept("auditor", temporary),
    () => nominate("auditor", temporary, auditor),
    () => accept("auditor", auditor),
    async () => {
      if (await read<number>("reserveStatus", [temporary.address]) !== 0) await send(company, "removeReserve", [temporary.address]);
      if (!isAddressEqual(await holder(), zeroAddress)) throw new Error(`${arm}: removal did not release the directory claim`);
    },
    async () => {
      if (await read<number>("reserveStatus", [temporary.address]) === 0) await send(company, "proposeReserve", [temporary.address]);
    },
    async () => {
      if (await read<number>("reserveStatus", [temporary.address]) === 1) await proveReserve(network, arm);
    },
    async () => {
      if (await read<number>("reserveStatus", [temporary.address]) === 2) await send(auditor, "reviewReserve", [temporary.address, true]);
      if (await read<number>("reserveStatus", [temporary.address]) !== 3 || !isAddressEqual(await holder(), registry)) {
        throw new Error(`${arm}: reserve restoration failed`);
      }
    },
    async () => {
      if (await read<bigint>("sampledWindow") === await read<bigint>("window")) await send(auditor, "discardSample");
    },
    async () => {
      for (const [role, original] of [["company", company], ["auditor", auditor]] as const) {
        if (!isAddressEqual(await read<Address>(role), original.address)) throw new Error(`${arm}: ${role} not restored`);
      }
      if (await read<number>("reserveStatus", [temporary.address]) !== 3) throw new Error(`${arm}: reserve not approved`);
    },
  ];
  for (let stage = start; stage < stages.length; stage++) {
    network.setStep(`${arm} operations ${stage}`);
    await stages[stage]();
    progress[arm] = stage + 1;
    network.save();
  }
  network.setStep("");
  console.log(`${arm}: both roles restored and reserve removal/re-approval verified; publish a fresh epoch next`);
}
