import React, { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import CommentItem from "@/components/tbr/CommentItem";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, MessageCircle } from "lucide-react";

// The discussion under a shared shelf or a shared book. Who may read it and who may post is
// settled by the comments function from the item itself - a share link opens the thread for
// anyone holding it, a shared shelf opens it for the reader's circle, and a block closes it.
export default function CommentsPanel({ token, shelfId, bookId, className = "" }) {
  const [comments, setComments] = useState([]);
  const [canPost, setCanPost] = useState(false);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await base44.functions.invoke("comments", {
        action: "list",
        token: token || "",
        shelf_id: shelfId || "",
        book_id: bookId || "",
      });
      setComments(res.data.comments || []);
      setCanPost(res.data.can_post === true);
    } catch {
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [token, shelfId, bookId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const post = async (e) => {
    e.preventDefault();
    const text = body.trim();
    if (!text || busy) return;
    setBusy("post");
    setNotice("");
    try {
      await base44.functions.invoke("comments", {
        action: "create",
        token: token || "",
        shelf_id: shelfId || "",
        book_id: bookId || "",
        parent_id: replyTo?.id || "",
        body: text,
      });
      setBody("");
      setReplyTo(null);
      await load();
    } catch (err) {
      setNotice(err?.response?.data?.error || "That comment didn't post. Please try again.");
    } finally {
      setBusy("");
    }
  };

  const report = async (comment) => {
    setBusy(comment.id);
    setNotice("");
    try {
      await base44.functions.invoke("comments", {
        action: "report",
        comment_id: comment.id,
        reason: "Reported from a comment thread",
      });
      setNotice("Thanks. That comment has been flagged for review.");
    } catch {
      setNotice("That didn't go through. Please try again.");
    } finally {
      setBusy("");
    }
  };

  const remove = async (comment) => {
    setBusy(comment.id);
    setNotice("");
    try {
      await base44.functions.invoke("comments", { action: "remove", comment_id: comment.id });
      await load();
    } catch {
      setNotice("That comment couldn't be removed.");
    } finally {
      setBusy("");
    }
  };

  const threads = comments.filter((c) => !c.parent_id);
  const repliesFor = (id) => comments.filter((c) => c.parent_id === id);

  return (
    <section className={`vp-shelf ${className}`}>
      <div className="vp-shelfhead">
        <div className="vp-titleline">
          <h2>Discussion</h2>
          {comments.length > 0 && <span className="vp-badge">{comments.length}</span>}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : threads.length === 0 ? (
        <p className="vp-empty flex items-center justify-center gap-2">
          <MessageCircle className="w-4 h-4" /> No comments yet. Start the conversation.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {threads.map((comment) => (
            <div key={comment.id}>
              <CommentItem
                comment={comment}
                busy={busy}
                onReply={canPost ? setReplyTo : undefined}
                onReport={report}
                onDelete={remove}
              />
              {repliesFor(comment.id).map((reply) => (
                <CommentItem key={reply.id} comment={reply} busy={busy} onReport={report} onDelete={remove} />
              ))}
            </div>
          ))}
        </div>
      )}

      {canPost ? (
        <form onSubmit={post} className="mt-4 space-y-2">
          {replyTo && (
            <p className="text-xs text-muted-foreground">
              Replying to {replyTo.author_name}.{" "}
              <button type="button" className="text-primary underline" onClick={() => setReplyTo(null)}>
                Cancel
              </button>
            </p>
          )}
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={replyTo ? `Reply to ${replyTo.author_name}` : "Say something about this list"}
            aria-label="Your comment"
          />
          <Button type="submit" disabled={busy === "post" || !body.trim()}>
            {busy === "post" ? <Loader2 className="w-4 h-4 animate-spin" /> : replyTo ? "Post reply" : "Post comment"}
          </Button>
        </form>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          <a href="/login" className="text-primary underline">Sign in</a> to join the discussion.
        </p>
      )}

      {notice && <p className="mt-3 text-sm text-muted-foreground">{notice}</p>}
    </section>
  );
}