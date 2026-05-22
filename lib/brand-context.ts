// Brand-context types — populated by the Connoisseur MCP integration the
// other session is building. This file is types + shape only; no fetching,
// no MCP client. When the MCP wire-up lands, only the route at
// app/api/brand-context/route.ts needs to change — every consumer (the IG
// page, future brand pages) reads through this shape.
//
// Source-of-truth tools on the Connoisseur MCP that feed each field:
//   sellingPoints       ← get_selling_points
//   winnerCombos        ← get_winner_combos
//   archetypePerf       ← get_archetype_performance
//   complianceGates     ← get_compliance_gates
//   voiceAtoms          ← get_voice_atoms
//   portfolioSnapshot   ← (computed: count_ads + concentration_audit + …)

export type SellingPoint = {
  label: string;          // e.g. "Sleep onset under 20 min"
  evidence?: string;      // 1-sentence proof / data point
  rank?: number;          // 1 = top
};

export type WinnerCombo = {
  archetype?: string;     // creator / format archetype this combo lives in
  hook?: string;
  visual?: string;
  cta?: string;
  win_rate?: number;      // 0..1 — share of ads in this combo that won
  sample_size?: number;
};

export type ArchetypePerformance = {
  archetype: string;
  win_rate?: number;
  tenure_days?: number;
  ads_count?: number;
  note?: string;          // 1-sentence color
};

export type ComplianceGate = {
  rule: string;           // e.g. "No 'cure' or 'treat'"
  severity?: "hard" | "soft";
  source?: string;        // e.g. "FDA structure-function"
};

export type VoiceAtom = {
  text: string;
  archetype?: string;
  freq?: number;          // how often it appears in the corpus
};

export type PortfolioSnapshot = {
  total_ads?: number;
  brands_tracked?: number;
  refreshed_at?: string;  // ISO date the snapshot was last computed
};

// The full payload returned by /api/brand-context for a given product.
// `available: false` means the MCP integration hasn't been wired yet
// (or the MCP couldn't reach the brand's slice); the UI handles that
// case as a graceful empty / skeleton state.
export type BrandContext = {
  available: boolean;
  product_id: string;
  brand: string | null;
  source: "connoisseur_mcp" | "stub" | null;
  fetched_at: number;     // epoch ms
  sellingPoints: SellingPoint[];
  winnerCombos: WinnerCombo[];
  archetypePerf: ArchetypePerformance[];
  complianceGates: ComplianceGate[];
  voiceAtoms: VoiceAtom[];
  portfolio: PortfolioSnapshot | null;
  // Hooks for diagnostics / debugging — surfaced in dev tools only.
  diagnostics?: {
    mcp_url?: string;
    last_error?: string;
  };
};

export function emptyBrandContext(product_id: string): BrandContext {
  return {
    available: false,
    product_id,
    brand: null,
    source: null,
    fetched_at: Date.now(),
    sellingPoints: [],
    winnerCombos: [],
    archetypePerf: [],
    complianceGates: [],
    voiceAtoms: [],
    portfolio: null,
  };
}
