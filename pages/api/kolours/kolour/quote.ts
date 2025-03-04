import { NextApiRequest, NextApiResponse } from "next";

import { assert } from "@/modules/common-utils";
import * as crypt from "@/modules/crypt";
import {
  KOLOURS_HMAC_SECRET,
  KOLOURS_KOLOUR_NFT_FEE_ADDRESS,
} from "@/modules/env/kolours/server";
import { getExpirationTime, parseKolour } from "@/modules/kolours/common";
import {
  calculateKolourFee,
  computeFees,
  lookupReferral,
} from "@/modules/kolours/fees";
import {
  generateKolourImageCid,
  getUnavailableKolours,
} from "@/modules/kolours/kolour";
import {
  Kolour,
  KolourEntry,
  KolourQuotation,
} from "@/modules/kolours/types/Kolours";
import { apiCatch, ClientError } from "@/modules/next-backend/api/errors";
import { sendJson } from "@/modules/next-backend/api/helpers";
import { db, ipfs, lucid$, redis } from "@/modules/next-backend/connections";

type Response = {
  quotation: KolourQuotation;
  signature: crypt.Base64;
  unavailable?: Kolour[];
};

export type QuoteKolourNft$Response = Response;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    assert(
      KOLOURS_HMAC_SECRET && KOLOURS_KOLOUR_NFT_FEE_ADDRESS,
      "kolour nft disabled"
    );

    ClientError.assert(req.method === "GET", {
      _debug: "invalid http method",
    });
    const { kolour: r_kolour, address } = req.query;

    ClientError.assert(address && typeof address === "string", {
      _debug: "invalid address",
    });

    const referral = await lookupReferral(lucid$, redis, db, address);

    const r_kolours = r_kolour
      ? typeof r_kolour === "string"
        ? r_kolour.split(",")
        : r_kolour
      : [];
    const kolours = Array.from(
      new Set(
        r_kolours.map((term) => {
          const kolour = parseKolour(term.trim());
          ClientError.assert(kolour, { _debug: `invalid kolour: ${term}` });
          return kolour;
        })
      )
    );
    ClientError.assert(kolours.length, { _debug: "kolour is required" });

    const unavailable = await getUnavailableKolours(db, kolours);
    const available = kolours.filter((k) => !unavailable.has(k));
    ClientError.assert(available.length, {
      _debug: "all selected kolours are unavailable",
    });

    const quotation: KolourQuotation = {
      kolours: Object.fromEntries(
        await Promise.all(
          available.map(async (kolour) => [
            kolour,
            await quoteKolour(kolour, referral?.discount),
          ])
        )
      ),
      userAddress: address,
      feeAddress: KOLOURS_KOLOUR_NFT_FEE_ADDRESS,
      referral: referral?.id,
      // TODO: @sk-saru: No, this shouldn't be multiplied by 1000...
      // It should be done by the tx building & verifying logic instead...
      expiration: getExpirationTime() * 1_000,
    };
    const signature = crypt.hmacSign(512, KOLOURS_HMAC_SECRET, {
      json: quotation,
    });
    const ret: Response = {
      quotation,
      signature,
      unavailable: unavailable.size ? Array.from(unavailable) : undefined,
    };
    sendJson(res, ret);
  } catch (error) {
    apiCatch(req, res, error);
  }
}

async function quoteKolour(
  kolour: Kolour,
  discount?: bigint
): Promise<KolourEntry> {
  const baseFee = calculateKolourFee(kolour);
  const cid = await generateKolourImageCid(redis, ipfs, kolour);
  return { ...computeFees(baseFee, discount), image: `ipfs://${cid}` };
}
