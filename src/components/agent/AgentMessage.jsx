import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Check, ChevronDown, Loader2, Wrench, X } from "lucide-react";

const parseJson = (value) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const pretty = (value) => {
  const parsed = parseJson(value);
  return typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2);
};

const RUNNING = ["pending", "running", "in_progress"];

// A step the host took, shown as the reader cares about it: whether it landed, and the
// detail only if they open it.
function ToolCall({ call }) {
  const [open, setOpen] = useState(false);
  const projection = call.display_projection || {};
  const hidden = projection.hide_details && projection.details_redacted;
  const parsed = parseJson(call.results);
  const failed = ["failed", "error"].includes(call.status) || parsed?.success === false;
  const running = RUNNING.includes(call.status);

  const label = hidden
    ? running
      ? projection.active_label
      : failed
        ? projection.error_label
        : projection.label
    : call.name;

  return (
    <div className="mt-2 text-xs">
      <button
        type="button"
        disabled={hidden}
        onClick={() => !hidden && setOpen((value) => !value)}
        className="flex items-center gap-1.5 text-muted-foreground"
      >
        {running ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : failed ? (
          <X className="w-3.5 h-3.5 text-destructive" />
        ) : (
          <Check className="w-3.5 h-3.5 text-primary" />
        )}
        <Wrench className="w-3.5 h-3.5" />
        <span>{label || "step"}</span>
        {!hidden && <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />}
      </button>

      {open && !hidden && (
        <div className="mt-1.5 space-y-1 rounded-lg border border-border bg-muted/40 p-2">
          <p className="text-[11px] text-muted-foreground">Parameters</p>
          <pre className="whitespace-pre-wrap break-words">{pretty(call.arguments_string)}</pre>
          {call.results !== undefined && (
            <>
              <p className="text-[11px] text-muted-foreground">Result</p>
              <pre className="whitespace-pre-wrap break-words">{pretty(call.results)}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function AgentMessage({ message }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-secondary-foreground border border-primary/20"
        }`}
      >
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        ) : (
          <>
            <div className="text-sm [&_a]:text-primary [&_a]:underline [&_li]:ml-4 [&_p]:mb-2 [&_p:last-child]:mb-0">
              <ReactMarkdown>{message.content || ""}</ReactMarkdown>
            </div>
            {(message.tool_calls || []).map((call, index) => (
              <ToolCall key={index} call={call} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}