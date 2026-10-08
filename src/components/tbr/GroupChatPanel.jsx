import React, { useEffect, useRef, useState } from "react";
import moment from "moment";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Loader2, Send, Users } from "lucide-react";

export default function GroupChatPanel({ group, onBack }) {
  const [messages, setMessages] = useState([]);
  const [readers, setReaders] = useState(0);
  const [status, setStatus] = useState("connecting");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const roomRef = useRef(null);
  const endRef = useRef(null);
  const viewerRef = useRef("");

  useEffect(() => {
    base44.auth.me().then((viewer) => { viewerRef.current = viewer?.full_name || ""; }).catch(() => {});
  }, []);

  useEffect(() => {
    let connId = sessionStorage.getItem("shelflife_conn");
    if (!connId) {
      connId = crypto.randomUUID();
      sessionStorage.setItem("shelflife_conn", connId);
    }

    setMessages([]);
    setError("");
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

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const send = (e) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !roomRef.current) return;
    roomRef.current.send({ type: "message", body, author_name: viewerRef.current });
    setDraft("");
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
              <span className="text-xs font-semibold text-primary">{message.author_name}</span>
              <span className="text-[11px] text-muted-foreground">{moment(message.at).format("h:mm a")}</span>
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
    </section>
  );
}