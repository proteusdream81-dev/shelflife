import React, { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Send } from "lucide-react";
import AgentMessage from "@/components/agent/AgentMessage";

const AGENT_NAME = "book_club_host";

// One conversation per reader, picked up again whenever they come back to the page.
export default function AgentChat({ greeting, suggestions = [] }) {
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef(null);

  useEffect(() => {
    let unsubscribe;
    let active = true;

    (async () => {
      try {
        const existing = await base44.agents.listConversations({ agent_name: AGENT_NAME });
        const list = Array.isArray(existing) ? existing : existing?.items || [];
        const current =
          list[0] ||
          (await base44.agents.createConversation({
            agent_name: AGENT_NAME,
            metadata: { name: "Book clubs", description: "Finding a club and sorting invites" },
          }));

        if (!active) return;
        setConversation(current);
        setMessages(current.messages || []);
        // Every streamed token lands here, so the reply appears as it is written.
        unsubscribe = base44.agents.subscribeToConversation(current.id, (data) => {
          setMessages(data.messages || []);
        });
      } catch {
        if (active) setError("The book club host isn't reachable right now. Please try again.");
      }
    })();

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages]);

  const send = async (text) => {
    const content = String(text ?? input).trim();
    if (!content || !conversation || sending) return;

    setInput("");
    setSending(true);
    setError("");
    // The reader's own line shows straight away; the streamed history then takes over.
    setMessages((prev) => [...prev, { role: "user", content }]);
    try {
      await base44.agents.addMessage(conversation, { role: "user", content });
    } catch {
      setError("That message didn't send. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const last = messages[messages.length - 1];
  const thinking = sending || last?.role === "user";

  return (
    <section className="vp-shelf">
      <div className="vp-shelfhead">
        <div className="vp-titleline">
          <h2>Book club host</h2>
        </div>
      </div>

      <div className="max-h-[55vh] min-h-[200px] overflow-y-auto space-y-3 pr-1">
        {messages.length === 0 && !thinking && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{greeting}</p>
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {suggestions.map((text) => (
                  <button key={text} type="button" className="vp-btn vp-small" onClick={() => send(text)}>
                    {text}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((message, index) => (
          <AgentMessage key={index} message={message} />
        ))}

        {thinking && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Looking into it...
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && <p className="text-sm text-destructive mt-3">{error}</p>}

      <form
        className="flex gap-2 mt-3"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <Input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask about a club or an invite..."
          className="h-11"
        />
        <Button type="submit" size="sm" disabled={thinking || !input.trim()} aria-label="Send">
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </section>
  );
}