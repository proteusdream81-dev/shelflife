import React from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

// The one thing a visitor holding a share link should be able to do: start a list of
// their own in a few seconds, landing back on the list they were just looking at.
export default function ShareJoinCard({ token, className }) {
  const returnTo = `/share/${token}`;
  const withReturn = `?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <section className={cn("vp-shelf text-center", className)}>
      <div className="vp-mark mx-auto">
        <BookOpen strokeWidth={1.8} />
      </div>
      <h2 className="text-2xl text-foreground mt-3">Start your own reading list</h2>
      <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
        Scan a barcode or search a title and it lands on your shelf in seconds. Free, and your
        shelves stay yours.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3 mt-5">
        <Button asChild>
          <Link to={`/register${withReturn}`}>Create your free account</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to={`/login${withReturn}`}>Log in</Link>
        </Button>
      </div>
    </section>
  );
}