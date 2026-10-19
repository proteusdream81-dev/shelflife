import React from "react";
import PolicySection from "@/components/legal/PolicySection";
import { DELETION_SECTIONS } from "@/lib/accountDeletionContent";

// The page's own explanation of what deleting an account covers, set the way the privacy policy
// sets its clauses so the two read as one document.
export default function DeletionInfo() {
  return (
    <div className="vp-panel p-6 sm:p-8">
      <h2 className="font-heading text-xl sm:text-2xl tracking-tight text-foreground">
        What deleting your account covers
      </h2>

      <div className="mt-5 pt-6 border-t border-primary/20">
        {DELETION_SECTIONS.map((section, index) => (
          <PolicySection
            key={section.heading}
            heading={section.heading}
            body={section.body}
            last={index === DELETION_SECTIONS.length - 1}
          />
        ))}
      </div>
    </div>
  );
}