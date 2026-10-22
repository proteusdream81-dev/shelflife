import React, { useEffect, useState } from "react";
import moment from "moment";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { CalendarPlus, Loader2, RefreshCw, Unlink } from "lucide-react";

// The reader's own Google Calendar connection, so release dates land where they look.
const CONNECTOR_ID = "6ada1fa329791f10bff48f77";

const SHOWN = 4;

export default function ReleaseRemindersCard() {
  const [authed, setAuthed] = useState(null);
  const [connected, setConnected] = useState(false);
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // One call both keeps the calendar in step and answers whether the reader is connected: the
  // function can only reach Google when their connection exists.
  const sync = async ({ quiet = false } = {}) => {
    if (!quiet) setBusy(true);
    try {
      const res = await base44.functions.invoke("releaseReminders", {});
      const data = res.data || {};
      setConnected(Boolean(data.connected));
      setReminders(data.reminders || []);
      setError("");
    } catch {
      if (!quiet) setError("Your calendar didn't answer just now. Please try again.");
    } finally {
      setLoading(false);
      if (!quiet) setBusy(false);
    }
  };

  useEffect(() => {
    base44.auth.isAuthenticated().then((isAuthed) => {
      setAuthed(isAuthed);
      if (isAuthed) return sync({ quiet: true });
      setLoading(false);
    });
  }, []);

  // Consent happens in its own tab, so the page watches for it to close and then syncs.
  const connect = async () => {
    setError("");
    try {
      const url = await base44.connectors.connectAppUser(CONNECTOR_ID);
      const popup = window.open(url, "_blank");
      const timer = setInterval(() => {
        if (!popup || popup.closed) {
          clearInterval(timer);
          sync();
        }
      }, 500);
    } catch {
      setError("We couldn't open Google Calendar just now. Please try again.");
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await base44.connectors.disconnectAppUser(CONNECTOR_ID);
      setConnected(false);
      setReminders([]);
      setError("");
    } catch {
      setError("We couldn't disconnect just now. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const shown = reminders.slice(0, SHOWN);
  const rest = reminders.length - shown.length;

  return (
    <section className="vp-panel p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="vp-mark shrink-0" aria-hidden="true">
          <CalendarPlus strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-lg leading-tight text-foreground">
            Release dates in your calendar
          </h2>

          {loading ? (
            <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Checking your calendar...
            </p>
          ) : connected ? (
            <p className="mt-1 text-sm leading-snug text-muted-foreground">
              {reminders.length === 0
                ? "Nothing coming up yet. Every Want to Read book with a release date ahead of it is added as an all-day event."
                : `${reminders.length} release ${reminders.length === 1 ? "date is" : "dates are"} on your Google Calendar.`}
            </p>
          ) : (
            <p className="mt-1 text-sm leading-snug text-muted-foreground">
              Connect your Google Calendar and every Want to Read book with a release date ahead
              of it is added as an all-day event, so a launch never slips past you.
            </p>
          )}

          {connected && reminders.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {shown.map((reminder) => (
                <li key={reminder.book_id} className="flex items-baseline gap-2 text-sm">
                  <span className="text-xs font-semibold text-primary shrink-0 w-20">
                    {moment(reminder.release_date).format("D MMM YYYY")}
                  </span>
                  <span className="min-w-0 truncate">{reminder.title}</span>
                </li>
              ))}
              {rest > 0 && (
                <li className="text-xs text-muted-foreground">and {rest} more on your calendar</li>
              )}
            </ul>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {authed === false ? (
              <Button size="sm" onClick={() => base44.auth.redirectToLogin()}>
                Sign in to connect
              </Button>
            ) : connected ? (
              <>
                <Button size="sm" variant="outline" onClick={() => sync()} disabled={busy}>
                  <RefreshCw className={busy ? "animate-spin" : undefined} />
                  {busy ? "Syncing..." : "Sync now"}
                </Button>
                <button
                  type="button"
                  onClick={disconnect}
                  disabled={busy}
                  className="text-xs font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-60"
                >
                  <Unlink className="w-3.5 h-3.5 inline mr-1 align-[-2px]" />
                  Disconnect
                </button>
              </>
            ) : (
              <Button size="sm" onClick={connect} disabled={loading}>
                <CalendarPlus />
                Connect Google Calendar
              </Button>
            )}
          </div>

          {error && <p className="mt-2 text-xs text-destructive" role="alert">{error}</p>}
        </div>
      </div>
    </section>
  );
}