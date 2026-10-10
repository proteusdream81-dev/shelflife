import React, { useEffect, useRef, useState } from "react";
import moment from "moment";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowLeft, Loader2, MoreVertical, Send, Trash2, UserMinus, Users } from "lucide-react";

export default function GroupChatPanel({ group, onBack, canModerate, kickUserId, onRemoveReader }) {
  const [messages, setMessages] = useState([]);
  const [readers, setReaders] = useState(0);
  const [status, setStatus] = useState("connecting");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [removed, setRemoved] = useState(false);
  const [busy, setBusy] = useState("");
  const [meId, setMeId] = useState("");
  const roomRef = useRef(null);
  const endRef = useRef(null);
  const viewerRef = useRef({ id: "", name: "" });

  useEffect(() => {
    base44.auth
      .me()
      .then((viewer) => {
        viewerRef.current = { id: viewer?.id || "", name: viewer?.full_name || "" };
        setMeId(viewer?.id || "");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let connId = sessionStorage.getItem("shelflife_conn");
    if (!connId) {
      connId = crypto.randomUUID();
      sessionStorage.setItem("shelflife_conn", connId);
    }

    setMessages([]);
    setError("");
    setRemoved(false);
    setStatus("connecting");

    const room = base44.actors.BookGroupRoom(group.id).connect({ id: connId });
    roomRef.current = room;

    const sub = room.subscribe((msg) => {
      if (!msg || typeof msg.type !== "string") return;
      if (msg.type === "history") {
        setMessages(msg.messages || []);
        setStatus("ready");
      } else if (msg.type === "message") {
        setMessages((prev) => [...prev, msg.message]);
      } else if (msg.type === "message_deleted") {
        setMessages((prev) => prev.filter((row) => row.id !== msg.id));
      } else if (msg.type === "reader_removed") {
        // Goes to the whole room; only the reader taken out is affected here.
        if (msg.user_id && msg.user_id === viewerRef.current.id) {
          setRemoved(true);
          setStatus("removed");
        }
      } else if (msg.type === "presence") {
        setReaders(msg.readers || 0);
      } else if (msg.type === "error") {
        setError(msg.text || "Something went wrong.");
      }
    });

    return () => {
      sub.unsubscribe();
      room.close();
      roomRef.current = null;
    };
  }, [group.id]);

  // The reader the owner just removed: the group record already carries the removal,
  // and this tells the room to stop serving them without waiting for a reconnect.
  useEffect(() => {
    if (!kickUserId) return;
    roomRef.current?.send({ type: "moderate", action: "remove_reader", user_id: kickUserId });
  }, [kickUserId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const send = (e) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !roomRef.current) return;
    roomRef.current.send({ type: "message", body, author_name: viewerRef.current.name });
    setDraft("");
  };

  const deleteMessage = (id) => roomRef.current?.send({ type: "moderate", action: "delete_message", id });

  const removeReader = async (userId, name) => {
    setBusy(userId);
    setError("");
    try {
      await onRemoveReader?.(userId);
    } catch (err) {
      setError(err?.response?.data?.error || `${name || "That reader"} could not be removed — please try again.`);
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="vp-shelf">
      <div className="vp-shelfhead">
        <div className="vp-titleline">
          <Button size="sm" variant="ghost" onClick={onBack} title="Back to groups" aria-label="Back to groups">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h2 className="truncate">{group.name}</h2>
        </div>
        <span className="vp-btn vp-small" aria-label={`${readers} readers in this group`}>
          <Users /> {readers} here
        </span>
      </div>

      {group.book_title && (
        <p className="text-xs text-primary/80 mb-3">Reading {group.book_title}</p>
      )}

      {removed ? (
        <p className="vp-empty">The group owner has removed you from this group, so you can no longer post here.</p>
      ) : (
        <>
          <div className="space-y-2 overflow-y-auto pr-1 max-h-[46vh]">
            {status === "connecting" && (
              <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" /> Joining the group...
              </div>
            )}

            {status === "ready" && messages.length === 0 && (
              <p className="vp-empty">No messages yet. Say hello to the group.</p>
            )}

            {messages.map((message) => (
              <div key={message.id} className="vp-panel p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-primary truncate">{message.author_name}</span>
                  <span className="flex items-center gap-1 shrink-0">
                    <span className="text-[11px] text-muted-foreground">{moment(message.at).format("h:mm a")}</span>
                    {canModerate && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            aria-label={`Moderate the message from ${message.author_name}`}
                          >
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-60">
                          <DropdownMenuItem className="gap-2" onClick={() => deleteMessage(message.id)}>
                            <Trash2 className="w-4 h-4" /> Delete message
                          </DropdownMenuItem>
                          {message.author_id && message.author_id !== meId && (
                            <DropdownMenuItem
                              className="gap-2 text-destructive focus:text-destructive"
                              disabled={busy === message.author_id}
                              onClick={() => removeReader(message.author_id, message.author_name)}
                            >
                              <UserMinus className="w-4 h-4" />
                              Remove {message.author_name} from group
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </span>
                </div>
                <p className="text-sm mt-1 break-words">{message.body}</p>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          {error && <p className="text-xs text-destructive mt-3">{error}</p>}

          <form onSubmit={send} className="vp-search mt-4">
            <Input
              className="vp-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Talk about the book..."
              maxLength={1000}
            />
            <Button type="submit" size="sm" className="vp-small" disabled={!draft.trim() || status !== "ready"}>
              <Send />
            </Button>
          </form>
        </>
      )}
    </section>
  );
}