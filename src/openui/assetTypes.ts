export interface AssetRequest {
  id: string;
  cardId: string;
  kind: "image" | "gallery";
  query: string;
  count: number;
  role: "hero" | "supporting" | "gallery";
}

export interface AssetRecord {
  id: string;
  kind: "image";
  src: string;
  alt: string;
  sourceUrl?: string;
  /** Which provider produced this asset. Never exposed to the model. */
  provider?: string;
  creator?: string;
  creatorUrl?: string;
  license?: string;
  licenseUrl?: string;
}

export interface AssetManifest {
  requests: AssetRequest[];
  assets: AssetRecord[];
}

export interface SafeAssetRef {
  id: string;
  kind: "image";
  alt: string;
  cardId: string;
}

/** Normalized image candidate shape shared by all providers. */
export interface ImageCandidate {
  imageUrl: string;
  sourceUrl?: string;
  alt?: string;
  creator?: string;
  creatorUrl?: string;
  license?: string;
  licenseUrl?: string;
}

export interface ImageSearchProvider {
  readonly kind?: string;
  search(args: { query: string; limit: number; signal?: AbortSignal }): Promise<unknown[]>;
}

export type AssetProviderState =
  | "disabled"
  | "noop-unconfigured"
  | "configured"
  | "provider-error"
  | "zero-results"
  | "validation-rejected"
  | "ready";

export type AssetResolutionStage =
  | "configuration"
  | "provider-request"
  | "provider-response"
  | "candidate-limit"
  | "url-parse"
  | "url-policy"
  | "dns"
  | "head"
  | "redirect"
  | "get-fallback";

export interface AssetResolutionDiagnosticEvent {
  stage: AssetResolutionStage;
  reason: string;
  requestId?: string;
  candidateIndex?: number;
  statusCode?: number;
  /** Which provider in the chain produced this event, when applicable. */
  provider?: string;
}

export interface AssetResolutionDiagnostics {
  providerState: AssetProviderState;
  providerKind: string;
  /** Provider kinds attempted, in order, without duplicates. */
  providersTried: string[];
  requests: number;
  candidates: number;
  accepted: number;
  rejected: number;
  events: AssetResolutionDiagnosticEvent[];
}

export interface AssetResolutionResult {
  manifest: AssetManifest;
  diagnostics: AssetResolutionDiagnostics;
}

export function safeAssetRefs(manifest: AssetManifest): SafeAssetRef[] {
  return manifest.assets.flatMap((asset) => {
    const request = [...manifest.requests].sort((a, b) => b.id.length - a.id.length).find((item) => asset.id === item.id || asset.id.startsWith(`${item.id}_`));
    return request ? [{ id: asset.id, kind: "image" as const, alt: asset.alt, cardId: request.cardId }] : [];
  });
}

export function invalidAssetRefsInTree(root: unknown, manifest: AssetManifest): string[] {
  const allowed = new Set(manifest.assets.map((asset) => asset.id));
  const found = new Set<string>();
  const seen = new Set<object>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object" || seen.has(value as object)) return;
    seen.add(value as object);
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const record = value as Record<string, unknown>;
    if (record.type === "element" && record.props && typeof record.props === "object") {
      const props = record.props as Record<string, unknown>;
      if (typeof props.assetRef === "string") found.add(props.assetRef);
      if (Array.isArray(props.assetRefs)) props.assetRefs.filter((item): item is string => typeof item === "string").forEach((item) => found.add(item));
      if (Array.isArray(props.items)) props.items.forEach((item) => {
        if (item && typeof item === "object" && typeof (item as Record<string, unknown>).assetRef === "string") found.add((item as Record<string, unknown>).assetRef as string);
      });
    }
    Object.values(record).forEach(visit);
  };
  visit(root);
  return [...found].filter((ref) => !allowed.has(ref)).sort();
}
