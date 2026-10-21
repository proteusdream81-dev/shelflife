import React from "react";

const LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g;

// Splits one stretch of policy wording into plain runs and real links, so the text can be held as
// it was written — [label](address) — and still reach the reader as something they can tap.
function withLinks(text) {
  const parts = [];
  let cursor = 0;
  let match;
  LINK_PATTERN.lastIndex = 0;

  while ((match = LINK_PATTERN.exec(text)) !== null) {
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    parts.push(
      <a
        key={`${match.index}-${match[2]}`}
        href={match[2]}
        className="text-primary underline underline-offset-2 break-words hover:text-accent"
      >
        {match[1]}
      </a>
    );
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

// One clause's worth of text: paragraphs, optional bold lead-ins and bulleted lists, in the order
// the policy states them.
export default function PolicyBlocks({ blocks = [] }) {
  return (
    <>
      {blocks.map((block, index) => {
        if (block.type === "ul") {
          return (
            <ul
              key={index}
              className="mt-3 space-y-2 pl-5 list-disc text-sm leading-relaxed text-foreground/85 marker:text-primary"
            >
              {block.items.map((item, itemIndex) =>
                typeof item === "string" ? (
                  <li key={itemIndex}>{withLinks(item)}</li>
                ) : (
                  <li key={itemIndex}>
                    <strong className="font-semibold text-foreground">{item.lead}</strong>{" "}
                    {withLinks(item.text)}
                  </li>
                )
              )}
            </ul>
          );
        }

        return (
          <p key={index} className="mt-2 text-sm leading-relaxed text-foreground/85">
            {block.lead && (
              <strong className="font-semibold text-foreground">{block.lead} </strong>
            )}
            {withLinks(block.text)}
          </p>
        );
      })}
    </>
  );
}