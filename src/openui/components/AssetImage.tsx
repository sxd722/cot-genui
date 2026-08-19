"use client";

import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod/v4";
import { useAssetRecord } from "../assetContext";

export const AssetImage = defineComponent({
  name: "AssetImage",
  description: "Displays a host-resolved image by assetRef. assetRef must come from availableAssets; never pass a URL.",
  props: z.object({ assetRef: z.string(), alt: z.string().optional(), aspect: z.enum(["wide", "square", "portrait"]).optional() }),
  component: function AssetImageRenderer({ props }) {
    const asset = useAssetRecord(props.assetRef);
    const aspect = props.aspect ?? "wide";
    if (!asset) return <div className={`openui-asset-placeholder openui-asset-placeholder--${aspect}`} data-asset-ref={props.assetRef}>图片暂不可用</div>;
    return <figure className={`openui-asset-image openui-asset-image--${aspect}`}>
      {/* Host validation and registry ownership make a dynamic remote img safer than model-authored URLs. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={asset.src} alt={props.alt ?? asset.alt} loading="lazy" referrerPolicy="no-referrer" />
    </figure>;
  },
});
