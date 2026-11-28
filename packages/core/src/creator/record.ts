export interface CreatorRelationship {
  creator: string;
  other: string;
  evidence: "shared_funder";
  commonControl: false;
}

export interface CreatorRecord {
  creator: string;
  holdings: readonly string[];
  sales: readonly string[];
  launches: readonly string[];
  relationships: readonly CreatorRelationship[];
}

export function creatorRecord(input: {
  creator: string;
  holdings: readonly string[];
  sales: readonly string[];
  launches: readonly string[];
  sharedFunderWith?: readonly string[];
}): CreatorRecord {
  return {
    creator: input.creator,
    holdings: input.holdings,
    sales: input.sales,
    launches: input.launches,
    relationships: (input.sharedFunderWith ?? []).map((other) => ({
      creator: input.creator,
      other,
      evidence: "shared_funder" as const,
      commonControl: false as const,
    })),
  };
}
