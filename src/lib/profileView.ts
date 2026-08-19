import type { ProfileDigest, ProfileViewDetail, ProfileViewV2 } from "./profileTypes";

interface FlatDetail { ref: string; text: string; domain: string; }

function terms(value: string): string[] {
  const lower = value.toLowerCase();
  const latin = lower.split(/[^a-z0-9_]+/).filter((term) => term.length >= 2);
  const cjk = [...lower.matchAll(/[\p{Script=Han}]{2,}/gu)].flatMap((match) => {
    const token = match[0];
    return token.length <= 4 ? [token] : [token, ...Array.from({ length: token.length - 1 }, (_, index) => token.slice(index, index + 2))];
  });
  return [...new Set([...latin, ...cjk])];
}

function flatten(value: unknown, path = "", domain = "general", output: FlatDetail[] = []): FlatDetail[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${path}[${index}]`, domain, output));
  } else if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => flatten(item, path ? `${path}.${key}` : key, path ? domain : key, output));
  } else if (path) {
    output.push({ ref: path, domain, text: `${path}: ${String(value ?? "")}` });
  }
  return output;
}

function freeTextDetails(value: string): FlatDetail[] {
  return value.split(/[。！？\n;；]+/).map((text) => text.trim()).filter(Boolean).map((text, index) => ({ ref: `free_text.sentence[${index}]`, domain: "free_text", text }));
}

function serializedLength(view: ProfileViewV2): number {
  return JSON.stringify(view).length;
}

function updateBudget(view: ProfileViewV2): number {
  let previous = -1;
  for (let index = 0; index < 4; index += 1) {
    const current = serializedLength(view);
    view.budget.profileViewChars = current;
    if (current === previous) return current;
    previous = current;
  }
  return serializedLength(view);
}

function trimToBudget(view: ProfileViewV2, hardMax: number): ProfileViewV2 {
  updateBudget(view);
  while (serializedLength(view) > hardMax && view.selectedDetails.length) view.selectedDetails.pop();
  let domainIndex = view.domainDirectory.length - 1;
  while (serializedLength(view) > hardMax && domainIndex >= 0) {
    const signals = view.domainDirectory[domainIndex].signals;
    if (signals.length) signals.pop(); else domainIndex -= 1;
  }
  while (serializedLength(view) > hardMax && view.stableCore.length) view.stableCore.pop();
  while (serializedLength(view) > hardMax && view.conflicts.length) view.conflicts.pop();
  while (serializedLength(view) > hardMax && view.domainDirectory.length) view.domainDirectory.pop();
  if (serializedLength(view) > hardMax) delete view.profileOverlay;
  updateBudget(view);
  return view;
}

export function buildProfileView(args: {
  query: string;
  digest: ProfileDigest;
  deviceContext?: Record<string, unknown>;
  freeText?: string;
  profileOverlay?: string;
  maxChars?: number;
}): ProfileViewV2 {
  const oldDigestChars = JSON.stringify(args.digest).length;
  const hardMax = Math.min(args.maxChars ?? 6_000, oldDigestChars);
  const queryTerms = terms(args.query);
  const overlayTerms = terms(args.profileOverlay ?? "");
  const constraintPattern = /health|allerg|mobility|chronic|family|child|children|spouse|parents|location|commute|transport|car|budget|payment|income|mortgage|preference|dislike|avoid|dietary|calendar|date|time|recent/i;
  const raw = args.freeText?.trim() ? freeTextDetails(args.freeText) : flatten(args.deviceContext ?? {});
  const scored = raw.map((detail) => {
    const haystack = `${detail.ref} ${detail.domain} ${detail.text}`.toLowerCase();
    const score = queryTerms.filter((term) => haystack.includes(term)).length * 6
      + overlayTerms.filter((term) => haystack.includes(term)).length * 4
      + queryTerms.filter((term) => detail.domain.toLowerCase().includes(term)).length * 3
      + (constraintPattern.test(detail.ref) ? 3 : 0)
      + (/date|time|recent|latest|calendar/i.test(detail.ref) ? 1 : 0);
    return { ...detail, score };
  }).sort((left, right) => right.score - left.score || left.ref.localeCompare(right.ref));
  const selectedDetails: ProfileViewDetail[] = [];
  const domainCounts = new Map<string, number>();
  for (const detail of scored) {
    const count = domainCounts.get(detail.domain) ?? 0;
    const strong = detail.score >= 6;
    if (count >= (strong ? 4 : 3)) continue;
    if (detail.score <= 0 && selectedDetails.length >= 6) continue;
    selectedDetails.push(detail);
    domainCounts.set(detail.domain, count + 1);
    if (selectedDetails.length >= 18) break;
  }
  const coreOrder: Array<keyof ProfileDigest["core"]> = ["healthConstraints", "household", "homeAndWork", "financialPosture", "persistentPreferences", "occupation", "demographics"];
  const stableCore = [...new Set([...coreOrder.flatMap((key) => args.digest.core[key]), ...args.digest.traits.map((trait) => trait.trait)])];
  const view: ProfileViewV2 = {
    version: "v2",
    stableCore,
    domainDirectory: args.digest.domains.map((domain) => ({ name: domain.name, summary: domain.summary, recordCount: domain.recordCount, signals: domain.availableSignals.slice(0, 8) })),
    selectedDetails,
    conflicts: args.digest.conflicts.map((conflict) => `${conflict.topic}：${conflict.description}`),
    ...(args.profileOverlay?.trim() ? { profileOverlay: [...args.profileOverlay.trim()].slice(0, 240).join("") } : {}),
    budget: { oldDigestChars, profileViewChars: 0 },
  };
  return trimToBudget(view, hardMax);
}
