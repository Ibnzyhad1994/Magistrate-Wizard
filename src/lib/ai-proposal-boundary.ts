/**
 * Integration boundary for a FUTURE AI-assisted legal ingestion service
 * (Phase 11 of the holistic ingestion repair pass).
 *
 * NOTHING in this file calls any AI provider. No AI provider or API key
 * is configured anywhere in this build. This file exists purely so a
 * future AI service can be wired in later without redesigning the
 * ingestion pipeline or Review Queue again — and so it is unmistakably
 * clear that no AI output currently reaches a canonical Case Law/
 * Legislation record, silently or otherwise.
 *
 * Design principle carried over from the rest of this pipeline: an AI
 * proposal is exactly that — a proposal. It is reviewable and
 * attributable (via `provider`/`modelVersion`/`generatedAt` on
 * `AiProposal`), and nothing in this codebase is permitted to write an
 * `AiProposal`'s fields directly into a canonical record without passing
 * through the same curator Review Queue every deterministic proposal
 * already goes through.
 */

export interface AiProposalInput {
  /** Sanitized, quality-gated extracted text ONLY — never raw/unvetted extraction output (see extraction-pipeline.ts). */
  extractedText: string;
  documentType: "case_law" | "legislation";
  /** Whatever the deterministic pipeline already proposed, so an AI provider can refine rather than duplicate it. */
  existingProposal: Record<string, unknown>;
}

export interface AiCaseLawProposal {
  case_name?: string;
  citation?: string;
  court?: string;
  jurisdiction?: string;
  decided_date?: string;
}

export interface AiProposal {
  caseMetadata?: AiCaseLawProposal;
  legalIssues?: string[];
  principles?: string[];
  subjectTags?: string[];
  legislationCited?: string[];
  casesCited?: string[];
  /** A structured headnote-style summary — still a PROPOSAL, never auto-applied as the canonical summary. */
  headnoteSummary?: string;
  /** 0-1, provider-reported. */
  confidence: number;
  provider: string;
  modelVersion: string;
  generatedAt: string;
}

export interface AiProposalProvider {
  isConfigured(): boolean;
  propose(input: AiProposalInput): Promise<AiProposal>;
}

/**
 * The only provider implementation that exists in this build. Always
 * reports itself as unconfigured, and always rejects rather than
 * fabricating a plausible-looking `AiProposal` — a fabricated proposal
 * that "looks real" would be exactly the "silently incorrect legal
 * content" this entire pass exists to prevent.
 */
export const noAiProposalProvider: AiProposalProvider = {
  isConfigured: () => false,
  propose: async () => {
    throw new Error(
      "No AI provider is configured in this build. This is expected: AI-assisted proposal generation is architecture-only in this pass, not implemented.",
    );
  },
};
