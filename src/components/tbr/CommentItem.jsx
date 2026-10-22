import React from "react";
import moment from "moment";
import { Flag, Reply, Trash2 } from "lucide-react";

// One comment, with the small actions that belong to it. A reply hangs under the comment it
// answers, indented and one level deep, so a thread stays readable on a phone.
export default function CommentItem({ comment, onReply, onReport, onDelete, busy }) {
  const when = comment.created_date ? moment(comment.created_date).fromNow() : "";

  return (
    <article className={`py-3 ${comment.parent_id ? "ml-4 pl-3 border-l border-primary/30" : ""}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold line-clamp-1">{comment.author_name}</p>
        <span className="text-[11px] text-muted-foreground shrink-0">{when}</span>
      </div>
      <p className="text-sm text-foreground/90 mt-1 whitespace-pre-wrap break-words">{comment.body}</p>
      <div className="flex items-center gap-3 mt-1.5">
        {onReply && !comment.parent_id && (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
            onClick={() => onReply(comment)}
          >
            <Reply className="w-3 h-3" /> Reply
          </button>
        )}
        {onReport && !comment.mine && (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-primary"
            onClick={() => onReport(comment)}
          >
            <Flag className="w-3 h-3" /> Report
          </button>
        )}
        {onDelete && comment.mine_to_delete && (
          <button
            type="button"
            disabled={busy === comment.id}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(comment)}
          >
            <Trash2 className="w-3 h-3" /> Delete
          </button>
        )}
      </div>
    </article>
  );
}