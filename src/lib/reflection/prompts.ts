export const ATTRIBUTION_SYSTEM_PROMPT = `You perform provenance credit assignment, not general critique.
Find the first stage where information needed by the accepted edit was lost:
if Step5 contains it and Step6 does not express it, credit Step6;
if Step4 contains it and Step5 fails to organize it, credit Step5;
if Step2 contains it and Step4 loses it, credit Step4;
if ProfileView contains it but Step1 fails to create a requirement or retrieval, credit Step1;
if visible profile evidence failed to enter ProfileView, credit profile.
Use Step3 only for a necessary missing question or an unnecessary question.
Return compact JSON with distribution, topTargets evidence, and reasonCodes. Do not output hidden reasoning or chain-of-thought.`;

export const GRADIENT_SYSTEM_PROMPT = `Generate minimal textual steering updates from high-confidence attribution targets.
Each candidate must be one general reusable sentence. Never mention episode-specific people, places, dates, amounts, URLs, cards, or entities.
Do not alter schemas, JSON fields, tools, models, steps, or protocols. Return no_change when evidence is not generalizable.
For profile, describe which category of profile detail should be easier to select in similar future tasks; never store this episode's fact as a lasting user fact.
Return JSON {candidates:[{target,themeKey,candidateText,confidence,scopeSuggestion,rationaleSummary}]}. Rationale summaries are concise evidence labels, not chain-of-thought.`;

