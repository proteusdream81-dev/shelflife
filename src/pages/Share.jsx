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
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
  }
  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center px-4">
        <BookOpen className="w-10 h-10 text-muted-foreground mb-3" />
        <p className="text-muted-foreground">This shared list isn't available.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="max-w-5xl mx-auto px-4 py-6">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center"><BookOpen className="w-4 h-4 text-primary-foreground" /></div>
            <span className="text-sm font-medium">TBR</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{data.shelf.name}</h1>
          {data.shelf.description && <p className="text-muted-foreground mt-1">{data.shelf.description}</p>}
          <p className="text-xs text-muted-foreground mt-2">{data.books.length} books</p>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">
        {data.books.length === 0 ? (
          <p className="text-muted-foreground text-center py-10">No books in this list.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {data.books.map((b, i) => (
              <div key={i}>
                <div className="aspect-[2/3] rounded-lg overflow-hidden bg-muted border border-border shadow-sm">
                  {b.cover_url ? (
                    <Image src={b.cover_url} alt={b.title} fittingType="fill" className="w-full h-full" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center p-2 text-center">
                      <span className="text-xs text-muted-foreground line-clamp-3">{b.title}</span>
                    </div>
                  )}
                </div>
                <h3 className="mt-2 text-sm font-medium line-clamp-2 leading-tight">{b.title}</h3>
                <p className="text-xs text-muted-foreground line-clamp-1">{b.author || "Unknown"}</p>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}