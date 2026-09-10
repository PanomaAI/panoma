"use client";

import { HiOutlineEye, HiOutlineEyeSlash, HiOutlineShare } from "react-icons/hi2";
import { useT } from "./i18n-provider";

/** Presentation controls stay visible and use the same labels in either state. */
export function CatalogActions({
  discreet,
  onToggleDiscreet,
  onShare,
}: {
  discreet: boolean;
  onToggleDiscreet: () => void;
  onShare: () => void;
}) {
  const t = useT();
  return (
    <div className="catalog-actions" role="group" aria-label={t("catalog.presentation")}>
      <button type="button" aria-pressed={discreet} onClick={onToggleDiscreet}
        title={t(discreet ? "store.showNames" : "store.hideNames")}>
        {discreet ? <HiOutlineEyeSlash aria-hidden /> : <HiOutlineEye aria-hidden />}
        <span>{t("catalog.discreet")}</span>
      </button>
      <button type="button" onClick={onShare}>
        <HiOutlineShare aria-hidden /><span>{t("catalog.share")}</span>
      </button>
    </div>
  );
}
