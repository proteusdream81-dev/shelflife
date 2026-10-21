import React from "react";
import PolicySection from "@/components/legal/PolicySection";
import { DELETION_SECTIONS } from "@/lib/accountDeletionContent";

// The page's own account of what deleting covers, set the way the privacy policy sets its
// clauses so the two read as one document.
export default function DeletionInfo() {
  return (
    <div className="vp-panel p-6 sm:p-8">
      {DELETION_SECTIONS.map((section, index) => (
        <PolicySection
          key={section.heading}
          heading={section.heading}
          blocks={section.blocks}
          last={index === DELETION_SECTIONS.length - 1}
        />
      ))}
    </div>
  );
}