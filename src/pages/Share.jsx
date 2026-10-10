import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Image } from "@/components/ui/image";
import { BookOpen, Loader2 } from "lucide-react";

export default function Share() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      // A shared list is for signed-in readers: send anyone else to log in and
      // come straight back to this same link.
      const authed = await base44.auth.isAuthenticated().catch(() => false);
      if (!authed) {
        base44.auth.redirectToLogin(`/share/${token}`);
        return;
      }
      try {
        const res = await base44.functions.invoke("getSharedShelf", { token });
        setData(res.data);
      } catch (e) {
        setError(e.message || "Not found");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  if (loading) {
    return (
      <div className="vp-page flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="vp-page flex flex-col items-center justify-center text-center px-4">
        <BookOpen className="w-10 h-10 text-muted-foreground mb-3" strokeWidth={1.8} />
        <p className="text-muted-foreground">This shared list isn't available.</p>
      </div>
    );
  }

  return (
    <div className="vp-page">
      <header className="vp-top">
        <div className="vp-topin max-w-5xl mx-auto">
          <div className="vp-bar">
            <div className="vp-brand">
              <div className="vp-mark">
                <BookOpen strokeWidth={1.8} />
              </div>
              <div className="vp-brandtxt">
                <strong>TBR</strong>
                <span>Shared reading list</span>
              </div>
            </div>
          </div>
          <div className="vp-rule pb-3">
            <h1 className="text-3xl text-foreground">{data.shelf.name}</h1>
            {data.shelf.description && (
              <p className="text-sm text-muted-foreground mt-2">{data.shelf.description}</p>
            )}
            <p className="text-xs text-muted-foreground mt-2">{data.books.length} books</p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {data.books.length === 0 ? (
          <p className="vp-empty">No books in this list.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {data.books.map((b, i) => (
              <div key={i}>
                {b.cover_url ? (
                  <div className="vp-cover">
                    <Image src={b.cover_url} alt={b.title} fittingType="fill" className="w-full h-full" />
                  </div>
                ) : (
                  <div className="vp-cover vp-art">
                    <span>{b.title}</span>
                  </div>
                )}
                <h3 className="mt-2 text-sm leading-tight line-clamp-2 text-foreground">{b.title}</h3>
                <p className="text-xs text-muted-foreground line-clamp-1">{b.author || "Unknown"}</p>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}