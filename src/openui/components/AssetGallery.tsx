"use client";

import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod/v4";
import { useAssetRecord } from "../assetContext";

function GalleryImage({ assetRef }: { assetRef: string }) {
  const asset = useAssetRecord(assetRef);
  if (!asset) return <div className="openui-asset-placeholder" data-asset-ref={assetRef}>图片暂不可用</div>;
  return <figure className="openui-asset-image openui-asset-image--square">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={asset.src} alt={asset.alt} loading="lazy" referrerPolicy="no-referrer" />
  </figure>;
}

export const AssetGallery = defineComponent({
  name: "AssetGallery",
  description: "Displays host-resolved image IDs as a two- or three-column gallery. Never pass URLs.",
  props: z.object({ assetRefs: z.array(z.string()), columns: z.union([z.literal(2), z.literal(3)]).optional() }),
  component: ({ props }) => <div className={`openui-asset-gallery openui-asset-gallery--${props.columns ?? 2}`}>{props.assetRefs.map((assetRef) => <GalleryImage key={assetRef} assetRef={assetRef} />)}</div>,
});
