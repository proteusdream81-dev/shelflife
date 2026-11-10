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
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (readerUid) => {
    if (!readerUid) {
      setComments([]);
      setLoading(false);
      return;
    }
    try {
      setLoadError("");
      const page = await firebaseCommentsApi.listComments({ targetKind, targetId, ownerUid, limit: 100 });
      setComments((page.records || []).map((comment) => ({
        ...comment,
        author_name: comment.authorName,
        created_date: comment.createdAt,
        parent_id: comment.parentId,
        mine: comment.authorUid === readerUid,
        mine_to_delete: comment.authorUid === readerUid || ownerUid === readerUid,
      })));
    } catch (error) {
      setComments([]);
      setLoadError(error?.message || "We couldn't load the discussion just now.");
    } finally {
      setLoading(false);
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

  const report = async (comment) => {
    setBusy(comment.id);
    setNotice("");
    try {
      await firebaseCommentsApi.reportComment(comment.id, "Reported from a comment thread");
      setNotice("Thanks. That comment has been flagged for review.");
    } catch (error) {
      setNotice(error?.message || "That didn't go through. Please try again.");
    } finally {
      setBusy("");
    }
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
              <CommentItem comment={comment} busy={busy} onReply={!comment.parent_id ? setReplyTo : undefined} onReport={!comment.mine ? report : undefined} onDelete={comment.mine_to_delete ? remove : undefined} />
              {repliesFor(comment.id).map((reply) => (
                <CommentItem key={reply.id} comment={reply} busy={busy} onReport={!reply.mine ? report : undefined} onDelete={reply.mine_to_delete ? remove : undefined} />
              ))}
            </div>
          ))}
        </div>
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
