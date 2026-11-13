import React, { useCallback, useEffect, useState } from "react";
import { MessageCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import CommentItem from "@/components/tbr/CommentItem";
import { firebaseCommentsApi } from "@/lib/firebaseCommentsApi";
import { observeShelfLifeUser } from "@/lib/firebaseAuth";

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
    const unsubscribe = observeShelfLifeUser((user) => {
      const nextUid = user?.emailVerified ? user.uid : null;
      setUid(nextUid);
      if (nextUid) load(nextUid);
      else { setComments([]); setLoading(false); }
    });
    return () => unsubscribe();
  }, [load]);