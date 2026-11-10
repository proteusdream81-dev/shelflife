import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { firebaseGroupApi } from "@/lib/firebaseGroupApi";
import { observeFirebaseUser, signOutFirebase } from "@/lib/firebaseAuth";

const PREVIEW_ENABLED = import.meta.env?.VITE_FIREBASE_MIGRATION_PREVIEW_ENABLED === "true";

export default function FirebaseGroupsPreview() {
  const [user, setUser] = useState(null);
  const [scope, setScope] = useState("mine");
  const [groups, setGroups] = useState([]);
  const [activeGroup, setActiveGroup] = useState(null);
  const [roster, setRoster] = useState({ members: [], pending: [] });
  const [messages, setMessages] = useState([]);
  const [messageBody, setMessageBody] = useState("");
  const [inviteUid, setInviteUid] = useState("");
  const [newGroup, setNewGroup] = useState({ name: "", description: "", category: "", location: "", bookTitle: "", isPrivate: true });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => observeFirebaseUser((firebaseUser) => {
    setUser(firebaseUser?.emailVerified ? {
      uid: firebaseUser.uid,
      email: firebaseUser.email || "",
      displayName: firebaseUser.displayName || "",
    } : null);
  }), []);

  const loadGroups = useCallback(async (nextScope = scope) => {
    if (!user) return;
    setLoading(true);
    setError("");
    try {
      const result = await firebaseGroupApi.listGroups({ scope: nextScope, limit: 50 });
      setGroups(result.records || []);
    } catch (err) {
      setError(err?.message || "Could not load book groups.");
    } finally {
      setLoading(false);
    }
  }, [user, scope]);

  useEffect(() => { loadGroups(scope); }, [loadGroups, scope]);

  const openGroup = async (group) => {
    setActiveGroup(group);
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const [nextRoster, nextMessages] = await Promise.all([
        firebaseGroupApi.getGroupRoster(group.id),
        firebaseGroupApi.listMessages(group.id, 50),
      ]);
      setRoster(nextRoster);
      setMessages(nextMessages.records || []);
    } catch (err) {
      setError(err?.message || "Could not open this group.");
    } finally {
      setLoading(false);
    }
  };

  const refreshMessages = async () => {
    if (!activeGroup) return;
    try {
      const result = await firebaseGroupApi.listMessages(activeGroup.id, 50);
      setMessages(result.records || []);
    } catch (err) { setError(err?.message || "Could not refresh chat."); }
  };

  const createGroup = async (event) => {
    event.preventDefault();
    setLoading(true); setError(""); setNotice("");
    try {
      await firebaseGroupApi.createGroup(newGroup);
      setNewGroup({ name: "", description: "", category: "", location: "", bookTitle: "", isPrivate: true });
      setNotice("Group created.");
      await loadGroups("mine");
    } catch (err) { setError(err?.message || "Could not create the group."); }
    finally { setLoading(false); }
  };

  const runGroupAction = async (callback, success) => {
    setLoading(true); setError(""); setNotice("");
    try {
      await callback();
      setNotice(success);
      await loadGroups(scope);
      if (activeGroup) await openGroup(activeGroup);
    } catch (err) { setError(err?.message || "The group action failed."); }
    finally { setLoading(false); }
  };

  const sendMessage = async (event) => {
    event.preventDefault();
    if (!activeGroup || !messageBody.trim()) return;
    setLoading(true); setError("");
    try {
      await firebaseGroupApi.sendMessage(activeGroup.id, messageBody);
      setMessageBody("");
      await refreshMessages();
    } catch (err) { setError(err?.message || "Message could not be sent."); }
    finally { setLoading(false); }
  };

  const closeGroup = async () => {
    if (!activeGroup || !window.confirm("Close this group? Members will lose access to its chat, but historical data will be retained.")) return;
    setLoading(true); setError(""); setNotice("");
    try {
      await firebaseGroupApi.closeGroup(activeGroup.id);
      setActiveGroup(null);
      setNotice("Group closed.");
      await loadGroups(scope);
    } catch (err) { setError(err?.message || "Could not close the group."); }
    finally { setLoading(false); }
  };

  const leaveGroup = async () => {
    if (!activeGroup) return;
    setLoading(true); setError(""); setNotice("");
    try {
      await firebaseGroupApi.leaveGroup(activeGroup.id);
      setActiveGroup(null);
      setNotice("You left the group.");
      await loadGroups(scope);
    } catch (err) { setError(err?.message || "Could not leave the group."); }
    finally { setLoading(false); }
  };

  if (!PREVIEW_ENABLED) {
    return <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Firebase book groups preview</h1>
      <p className="mt-3 text-sm text-muted-foreground">This preview is disabled. Enable it only in the ShelfLife Vercel Preview environment after the current API validation.</p>
      <Link className="mt-4 inline-block underline" to="/firebase-auth-preview">Open Firebase authentication preview</Link>
    </main>;
  }

  if (!user) {
    return <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Firebase book groups preview</h1>
      <p className="mt-3">Sign in with a verified Firebase account that has a completed ShelfLife identity link and migrated profile.</p>
      <Link className="mt-4 inline-block underline" to="/firebase-auth-preview">Sign in with Firebase</Link>
    </main>;
  }

  return <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Preview only · Firebase backend</p>
        <h1 className="text-2xl font-semibold">Book groups</h1>
        <p className="text-sm text-muted-foreground">Signed in as {user.displayName || user.email}</p>
      </div>
      <div className="flex gap-2">
        <button className="rounded border px-3 py-2 text-sm" onClick={() => loadGroups(scope)}>Refresh</button>
        <button className="rounded border px-3 py-2 text-sm" onClick={() => signOutFirebase()}>Sign out</button>
        <Link className="rounded border px-3 py-2 text-sm" to="/firebase-auth-preview">Auth diagnostics</Link>
      </div>
    </header>

    {(error || notice) && <div className={`rounded border p-3 text-sm ${error ? "border-red-300 text-red-700" : "border-green-300 text-green-700"}`}>{error || notice}</div>}

    <nav className="flex flex-wrap gap-2">
      {["mine", "public", "invited"].map((value) => <button key={value} onClick={() => { setActiveGroup(null); setScope(value); }}
        className={`rounded border px-3 py-2 text-sm ${scope === value ? "bg-primary text-primary-foreground" : ""}`}>
        {value === "mine" ? "My groups" : value === "public" ? "Public groups" : "Invitations"}
      </button>)}
    </nav>

    {!activeGroup && <section className="grid gap-6 md:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-3">
        <h2 className="font-semibold">{scope === "mine" ? "Your groups" : scope === "public" ? "Discover public groups" : "Pending invitations"}</h2>
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!loading && groups.length === 0 && <p className="text-sm text-muted-foreground">No groups found in this scope.</p>}
        {groups.map((group) => <article key={group.id} className="space-y-2 rounded-lg border p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold">{group.name}</h3>
              <p className="text-xs text-muted-foreground">{group.category || "General"} · {group.isPrivate ? "Private" : "Public"} · {group.role}</p>
            </div>
            {scope === "public" && <button className="rounded border px-3 py-1 text-sm" onClick={() => runGroupAction(() => firebaseGroupApi.joinPublicGroup(group.id), "Joined group.")}>Join</button>}
            {scope === "invited" && <div className="flex gap-2">
              <button className="rounded border px-3 py-1 text-sm" onClick={() => runGroupAction(() => firebaseGroupApi.respondToInvite(group.id, group.inviteId, "accept"), "Invitation accepted.")}>Accept</button>
              <button className="rounded border px-3 py-1 text-sm" onClick={() => runGroupAction(() => firebaseGroupApi.respondToInvite(group.id, group.inviteId, "decline"), "Invitation declined.")}>Decline</button>
            </div>}
            {scope === "mine" && <button className="rounded border px-3 py-1 text-sm" onClick={() => openGroup(group)}>Open</button>}
          </div>
          {group.description && <p className="text-sm">{group.description}</p>}
          {group.bookTitle && <p className="text-xs text-muted-foreground">Reading: {group.bookTitle}</p>}
        </article>)}
      </div>
      {scope === "mine" && <form onSubmit={createGroup} className="h-fit space-y-3 rounded-lg border p-4">
        <h2 className="font-semibold">Create a group</h2>
        <input className="w-full rounded border p-2 text-sm" placeholder="Group name" value={newGroup.name} onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })} required maxLength={80}/>
        <textarea className="w-full rounded border p-2 text-sm" placeholder="Description" value={newGroup.description} onChange={(e) => setNewGroup({ ...newGroup, description: e.target.value })} maxLength={1000}/>
        <input className="w-full rounded border p-2 text-sm" placeholder="Category" value={newGroup.category} onChange={(e) => setNewGroup({ ...newGroup, category: e.target.value })} maxLength={80}/>
        <input className="w-full rounded border p-2 text-sm" placeholder="Location" value={newGroup.location} onChange={(e) => setNewGroup({ ...newGroup, location: e.target.value })} maxLength={120}/>
        <input className="w-full rounded border p-2 text-sm" placeholder="Book title (optional)" value={newGroup.bookTitle} onChange={(e) => setNewGroup({ ...newGroup, bookTitle: e.target.value })} maxLength={160}/>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={newGroup.isPrivate} onChange={(e) => setNewGroup({ ...newGroup, isPrivate: e.target.checked })}/> Private group (invitation only)</label>
        <button className="w-full rounded bg-primary px-3 py-2 text-sm text-primary-foreground" disabled={loading}>Create group</button>
      </form>}
    </section>}

    {activeGroup && <section className="grid gap-6 md:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><button className="text-sm underline" onClick={() => setActiveGroup(null)}>← Groups</button><h2 className="text-xl font-semibold">{activeGroup.name}</h2></div>
          <button className="rounded border px-3 py-2 text-sm" onClick={refreshMessages}>Refresh chat</button>
        </div>
        <div className="max-h-[55vh] space-y-3 overflow-y-auto rounded-lg border p-4">
          {messages.map((message) => <article key={message.id} className="rounded bg-muted/40 p-3">
            <div className="flex justify-between gap-2 text-xs text-muted-foreground"><span>{message.displayName}</span><span>{message.createdAt || ""}</span></div>
            <p className="mt-1 whitespace-pre-wrap text-sm">{message.body}</p>
            {activeGroup.ownerUid === user.uid && <button className="mt-2 text-xs underline" onClick={() => runGroupAction(() => firebaseGroupApi.deleteMessage(activeGroup.id, message.id), "Message removed.")}>Remove message</button>}
          </article>)}
          {messages.length === 0 && <p className="text-sm text-muted-foreground">No messages yet.</p>}
        </div>
        <form onSubmit={sendMessage} className="flex gap-2">
          <textarea className="min-h-12 flex-1 rounded border p-2 text-sm" placeholder="Write a group message…" value={messageBody} onChange={(e) => setMessageBody(e.target.value)} maxLength={1000}/>
          <button className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground" disabled={loading || !messageBody.trim()}>Send</button>
        </form>
      </div>
      <aside className="space-y-4 rounded-lg border p-4">
        <h3 className="font-semibold">Members</h3>
        {roster.members.map((member) => <div key={member.id} className="flex justify-between gap-2 text-sm">
          <span>{member.name} <span className="text-xs text-muted-foreground">({member.role})</span></span>
          {activeGroup.role === "owner" && member.id !== user.uid && <button className="text-xs underline" onClick={() => runGroupAction(() => firebaseGroupApi.removeReader(activeGroup.id, member.id), "Member removed.")}>Remove</button>}
        </div>)}
        {activeGroup.role === "owner" && <>
          <form onSubmit={(event) => { event.preventDefault(); runGroupAction(() => firebaseGroupApi.inviteReader(activeGroup.id, inviteUid.trim()), "Invitation sent."); setInviteUid(""); }} className="space-y-2 border-t pt-3">
            <label className="text-sm font-medium">Invite Firebase UID</label>
            <input className="w-full rounded border p-2 text-sm" value={inviteUid} onChange={(e) => setInviteUid(e.target.value)} placeholder="Reader UID" required/>
            <button className="w-full rounded border px-3 py-2 text-sm" disabled={loading}>Invite reader</button>
          </form>
          {roster.pending.length > 0 && <div className="border-t pt-3"><h4 className="mb-2 text-sm font-medium">Pending invitations</h4>{roster.pending.map((invite) => <p key={invite.id} className="text-sm">{invite.name}</p>)}</div>}
          <button className="w-full rounded border px-3 py-2 text-sm text-red-700" onClick={closeGroup}>Close group</button>
        </>}
        {activeGroup.role !== "owner" && <button className="w-full rounded border px-3 py-2 text-sm" onClick={leaveGroup}>Leave group</button>}
      </aside>
    </section>}
  </main>;
}
