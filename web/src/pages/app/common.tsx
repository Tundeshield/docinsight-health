import { Link } from "react-router-dom";
import { FileText, ListChecks, Link2, Image as ImageIcon, Star } from "lucide-react";
import type { ContentItem } from "../../../../shared/src/types";
import { DOCUMENT_TYPES } from "../../../../shared/src/config";
import { fmtDate, isOverdue } from "../../lib/format";
import { cx } from "../../components/ui";

export const docTypeLabel = (t: string) => DOCUMENT_TYPES.find((d) => d.id === t)?.label ?? "Document";
export const TypeIcon = ({ type, className = "h-5 w-5" }: { type: string; className?: string }) => {
  const I = type === "checklist" ? ListChecks : type === "link" ? Link2 : type === "image" ? ImageIcon : FileText;
  return <I className={className} aria-hidden />;
};

export function DocRow({ c, to, fav, extra }: { c: ContentItem & { id: string }; to?: string; fav?: boolean; extra?: React.ReactNode }) {
  const href = to ?? (c.source === "hub" ? `/app/hub/doc/${c.id}` : `/app/doc/${c.id}`);
  return (
    <li>
      <Link to={href} className="flex items-start gap-3 px-4 py-3 hover:bg-soft">
        <span className="mt-0.5 text-ink-2"><TypeIcon type={c.type} /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-2"><span className="font-bold">{c.title}</span>{fav && <Star className="mt-1 h-4 w-4 shrink-0 fill-current text-brand" aria-label="Favourite" />}</span>
          <span className="block text-[13px] text-ink-2">
            {docTypeLabel(c.documentType)}
            {c.currentVersionNumber ? ` · v${c.currentVersionNumber}` : ""}
            {c.effectiveDate ? ` · effective ${fmtDate(c.effectiveDate)}` : ""}
            {c.source === "hub" && c.sourceName ? ` · ${c.sourceName}` : ""}
          </span>
          {extra}
        </span>
        {c.mustRead && <span className="pill bg-warn-bg text-warn">Must read</span>}
        {c.source !== "hub" && isOverdue(c.reviewDate) && <span className={cx("pill bg-soft text-ink-2")} title="Review date has passed">Review due</span>}
      </Link>
    </li>
  );
}
