import { z } from 'zod';
import { PROSPECT_STAGES } from './prospects';

/** Résumé d'un prospect (listes, panneau des salles, missions). */
export const prospectSummarySchema = z.object({
  id: z.string(),
  reference: z.string(),
  creatorName: z.string(),
  channelName: z.string(),
  stage: z.enum(PROSPECT_STAGES),
});
export type ProspectSummary = z.infer<typeof prospectSummarySchema>;
