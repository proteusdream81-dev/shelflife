import React, { useCallback, useEffect, useState } from "react";
import { MessageCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import CommentItem from "@/components/tbr/CommentItem";
import { firebaseCommentsApi } from "@/lib/firebaseCommentsApi";
import { observeFirebaseUser } from "@/lib/firebaseAuth";

export default function FirebaseCommentsPanel({ targetKind, targetId, ownerUid, className = "" }) {
  const [comments, setComments] = useState([]);
  const [uid, setUid] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [reportTarget, setReportTarget] = useState(null);
  const [reportReason, setReportReason] = useState("");
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (readerUid, { cursor = null, append = false } = {}) => {
    if (!readerUid) {
      setComments([]);
      setNextCursor(null);
      setLoading(false);
      return;
    }
    try {
      setLoadError("");
      const page = await firebaseCommentsApi.listComments({ targetKind, targetId, ownerUid, limit: 100, cursor });
      const records = (page.records || []).map((comment) => ({
        ...comment,
        author_name: comment.authorName,
        created_date: comment.createdAt,
        parent_id: comment.parentId,
        mine: comment.authorUid === readerUid,
        mine_to_delete: comment.authorUid === readerUid || ownerUid === readerUid,
      }));
      setComments((current) => append ? [...current, ...records] : records);
      setNextCursor(page.nextCursor || null);
    } catch (error) {
      if (!append) setComments([]);
      setLoadError(error?.message || "We couldn't load the discussion just now.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [targetKind, targetId, ownerUid]);

  useEffect(() => {
    setLoading(true);
    const unsubscribe = observeFirebaseUser((user) => {
      const nextUid = user?.emailVerified ? user.uid : null;
      setUid(nextUid);
      if (nextUid) load(nextUid);
      else { setComments([]); setLoading(false); }
    });
    return () => unsubscribe();
  }, [load]);

  const post = async (event) => {
    event.preventDefault();
    const text = body.trim();
    if (!text || busy || !uid) return;
    setBusy("post");
    setNotice("");
    try {
      await firebaseCommentsApi.createComment({
        targetKind, targetId, ownerUid, body: text, parentId: replyTo?.id || null,
      });
      setBody("");
      setReplyTo(null);
      await load(uid);
    } catch (error) {
      setNotice(error?.message || "That comment didn't post. Please try again.");
    } finally {
      setBusy("");
    }
  };

  const submitReport = async (event) => {
    event.preventDefault();
    const reason = reportReason.trim();
    if (!reportTarget || !reason || busy) return;
    setBusy(reportTarget.id);
    setNotice("");
    try {
      const result = await firebaseCommentsApi.reportComment(reportTarget.id, reason);
      setReportTarget(null);
      setReportReason("");
      setNotice(result.alreadyReported ? "You have already reported this comment. It remains in the moderation queue." : "Thanks. Your report has been sent to the moderation queue.");
    } catch (error) {
      setNotice(error?.message || "That didn't go through. Please try again.");
    } finally {
      setBusy("");
    }
  };

  const loadMore = async () => {
    if (!uid || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    await load(uid, { cursor: nextCursor, append: true });
  };

  const remove = async (comment) => {
    setBusy(comment.id);
    setNotice("");
    try {
      await firebaseCommentsApi.deleteComment(comment.id);
      await load(uid);
    } catch (error) {
      setNotice(error?.message || "That comment couldn't be removed.");
    } finally {
      setBusy("");
    }
  };

  const threads = comments.filter((comment) => !comment.parent_id);
  const repliesFor = (id) => comments.filter((comment) => comment.parent_id === id);

  return (
    <section className={`vp-shelf ${className}`}>
      <div className="vp-shelfhead">
        <div className="vp-titleline">
          <h2>Discussion</h2>
          {comments.length > 0 && <span className="vp-badge">{comments.length}</span>}
        </div>
      </div>
      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : loadError ? (
        <div className="py-4 text-center space-y-2">
          <p className="text-sm text-destructive">{loadError}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => { setLoading(true); load(uid); }}>Try again</Button>
        </div>
      ) : !uid ? (
        <p className="mt-4 text-sm text-muted-foreground">
          <a href="/login" className="text-primary underline">Sign in</a> to view and join the discussion.
        </p>
      ) : threads.length === 0 ? (
        <p className="vp-empty flex items-center justify-center gap-2"><MessageCircle className="w-4 h-4" /> No comments yet. Start the conversation.</p>
      ) : (
        <div className="divide-y divide-border">
          {threads.map((comment) => (
            <div key={comment.id}>
              <CommentItem comment={comment} busy={busy} onReply={!comment.parent_id ? setReplyTo : undefined} onReport={!comment.mine ? (target) => { setReportTarget(target); setReportReason(""); setNotice(""); } : undefined} onDelete={comment.mine_to_delete ? remove : undefined} />
              {repliesFor(comment.id).map((reply) => (
                <CommentItem key={reply.id} comment={reply} busy={busy} onReport={!reply.mine ? (target) => { setReportTarget(target); setReportReason(""); setNotice(""); } : undefined} onDelete={reply.mine_to_delete ? remove : undefined} />
              ))}
            </div>
          ))}
        </div>
      )}
      {uid && nextCursor && (
        <div className="pt-3 text-center"><Button type="button" size="sm" variant="outline" disabled={loadingMore} onClick={loadMore}>{loadingMore ? "Loading older comments…" : "Load older comments"}</Button></div>
      )}
      {reportTarget && (
        <form onSubmit={submitReport} className="mt-4 space-y-2 rounded-lg border p-3">
          <p className="text-sm font-medium">Report {reportTarget.author_name}'s comment</p>
          <Textarea value={reportReason} onChange={(event) => setReportReason(event.target.value)} rows={2} maxLength={500} placeholder="Tell the moderators why this comment should be reviewed" aria-label="Reason for reporting this comment" />
          <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={busy === reportTarget.id || !reportReason.trim()}>{busy === reportTarget.id ? "Sending…" : "Submit report"}</Button><Button type="button" size="sm" variant="outline" onClick={() => { setReportTarget(null); setReportReason(""); }}>Cancel</Button></div>
        </form>
      )}
      {uid && (
        <form onSubmit={post} className="mt-4 space-y-2">
          {replyTo && (
            <p className="text-xs text-muted-foreground">
              Replying to {replyTo.author_name}.{" "}
              <button type="button" className="text-primary underline" onClick={() => setReplyTo(null)}>Cancel</button>
            </p>
          )}
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={replyTo ? `Reply to ${replyTo.author_name}` : "Say something about this list"}
            aria-label="Your comment"
          />
          <Button type="submit" disabled={busy === "post" || !body.trim()}>
            {busy === "post" ? <Loader2 className="w-4 h-4 animate-spin" /> : replyTo ? "Post reply" : "Post comment"}
          </Button>
        </form>
      )}
      {notice && <p className="mt-3 text-sm text-muted-foreground">{notice}</p>}
    </section>
  );
}
