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

export interface ImageSearchProvider {
  search(args: { query: string; limit: number }): Promise<Array<{ imageUrl: string; sourceUrl?: string; alt?: string }>>;
}

export function safeAssetRefs(manifest: AssetManifest): SafeAssetRef[] {
  return manifest.assets.flatMap((asset) => {
    const request = [...manifest.requests].sort((a, b) => b.id.length - a.id.length).find((item) => asset.id === item.id || asset.id.startsWith(`${item.id}_`));
    return request ? [{ id: asset.id, kind: "image" as const, alt: asset.alt, cardId: request.cardId }] : [];
  });
}
