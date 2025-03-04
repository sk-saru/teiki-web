import { Core, Lucid } from "lucid-cardano";

import { LovelaceAmount } from "../business-types";

import { Kolour } from "./types/Kolours";

export const QUOTATION_TTL = 600; // 10 minutes

export const FEE_MULTIPLIER = BigInt(2);

export function parseKolour(text: unknown): Kolour | undefined {
  if (text && typeof text === "string" && /^[0-9A-Fa-f]{6}$/.test(text))
    return text.toUpperCase();
  return undefined;
}

export function getExpirationTime(now?: number): number {
  let unixSecs = Math.trunc((now ?? Date.now()) / 1000);
  // Less signature leak
  unixSecs -= unixSecs % 60;
  return unixSecs + QUOTATION_TTL;
}

export function getTxExp(lucid: Lucid, txBody: Core.TransactionBody) {
  const txTtl = txBody.ttl();
  if (txTtl == null) return null;
  const slot = Number(txTtl.to_str());
  const time = lucid.utils.slotToUnixTime(slot);
  return { slot, time };
}
