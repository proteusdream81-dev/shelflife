import blocksByUid from "./_routes/blocks/[uid].js";
import blocksIndex from "./_routes/blocks/index.js";
import commentsIndex from "./_routes/comments.js";
import commentsById from "./_routes/comments/[id].js";
import commentsReport from "./_routes/comments/[id]/report.js";
import groupById from "./_routes/groups/[id].js";
import groupInvitesById from "./_routes/groups/[id]/invites.js";
import groupInviteRespond from "./_routes/groups/[id]/invites/[inviteId].js";
import groupJoinById from "./_routes/groups/[id]/join.js";
import groupMembersById from "./_routes/groups/[id]/members.js";
import groupMemberByUid from "./_routes/groups/[id]/members/[uid].js";
import groupMembershipById from "./_routes/groups/[id]/membership.js";
import groupMessagesById from "./_routes/groups/[id]/messages.js";
import groupMessageById from "./_routes/groups/[id]/messages/[messageId].js";
import groupsIndex from "./_routes/groups/index.js";
import groupsInvites from "./_routes/groups/invites.js";
import groupsJoin from "./_routes/groups/join.js";
import groupsMembers from "./_routes/groups/members.js";
import groupsMembership from "./_routes/groups/membership.js";
import groupsMessages from "./_routes/groups/messages.js";
import health from "./_routes/health.js";
import wifSmokeTest from "./_lib/wifSmokeTest.js";
import booksIndex from "./_routes/library/books.js";
import bookById from "./_routes/library/books/[id].js";
import bookCover from "./_routes/library/books/[id]/cover.js";
import bookSharing from "./_routes/library/books/[id]/sharing.js";
import shelvesIndex from "./_routes/library/shelves.js";
import shelfById from "./_routes/library/shelves/[id].js";
import shelfSharing from "./_routes/library/shelves/[id]/sharing.js";
import moderationReports from "./_routes/moderation/reports.js";
import moderationReportById from "./_routes/moderation/reports/[id].js";
import relationshipById from "./_routes/relationships/[id].js";
import relationshipsIndex from "./_routes/relationships/index.js";
import sharedIndex from "./_routes/shared.js";
import publicShare from "./share/[token].js";

const routes = [
  { pattern: /^\/api\/blocks$/, handler: blocksIndex },
  { pattern: /^\/api\/blocks\/([^/]+)$/, params: ["uid"], handler: blocksByUid },
  { pattern: /^\/api\/comments$/, handler: commentsIndex },
  { pattern: /^\/api\/comments\/([^/]+)\/report$/, params: ["id"], handler: commentsReport },
  { pattern: /^\/api\/comments\/([^/]+)$/, params: ["id"], handler: commentsById },
  { pattern: /^\/api\/groups\/invites$/, handler: groupsInvites },
  { pattern: /^\/api\/groups\/join$/, handler: groupsJoin },
  { pattern: /^\/api\/groups\/members$/, handler: groupsMembers },
  { pattern: /^\/api\/groups\/membership$/, handler: groupsMembership },
  { pattern: /^\/api\/groups\/messages$/, handler: groupsMessages },
  { pattern: /^\/api\/groups$/, handler: groupsIndex },
  { pattern: /^\/api\/groups\/([^/]+)\/invites\/([^/]+)$/, params: ["id", "inviteId"], handler: groupInviteRespond },
  { pattern: /^\/api\/groups\/([^/]+)\/invites$/, params: ["id"], handler: groupInvitesById },
  { pattern: /^\/api\/groups\/([^/]+)\/join$/, params: ["id"], handler: groupJoinById },
  { pattern: /^\/api\/groups\/([^/]+)\/members\/([^/]+)$/, params: ["id", "uid"], handler: groupMemberByUid },
  { pattern: /^\/api\/groups\/([^/]+)\/members$/, params: ["id"], handler: groupMembersById },
  { pattern: /^\/api\/groups\/([^/]+)\/membership$/, params: ["id"], handler: groupMembershipById },
  { pattern: /^\/api\/groups\/([^/]+)\/messages\/([^/]+)$/, params: ["id", "messageId"], handler: groupMessageById },
  { pattern: /^\/api\/groups\/([^/]+)\/messages$/, params: ["id"], handler: groupMessagesById },
  { pattern: /^\/api\/groups\/([^/]+)$/, params: ["id"], handler: groupById },
  { pattern: /^\/api\/health$/, handler: health },
  { pattern: /^\/api\/library\/books$/, handler: booksIndex },
  { pattern: /^\/api\/library\/books\/([^/]+)\/cover$/, params: ["id"], handler: bookCover },
  { pattern: /^\/api\/library\/books\/([^/]+)\/sharing$/, params: ["id"], handler: bookSharing },
  { pattern: /^\/api\/library\/books\/([^/]+)$/, params: ["id"], handler: bookById },
  { pattern: /^\/api\/library\/shelves$/, handler: shelvesIndex },
  { pattern: /^\/api\/library\/shelves\/([^/]+)\/sharing$/, params: ["id"], handler: shelfSharing },
  { pattern: /^\/api\/library\/shelves\/([^/]+)$/, params: ["id"], handler: shelfById },
  { pattern: /^\/api\/moderation\/reports$/, handler: moderationReports },
  { pattern: /^\/api\/moderation\/reports\/([^/]+)$/, params: ["id"], handler: moderationReportById },
  { pattern: /^\/api\/migration\/wif-smoke-test$/, handler: wifSmokeTest },
  { pattern: /^\/api\/relationships$/, handler: relationshipsIndex },
  { pattern: /^\/api\/relationships\/([^/]+)$/, params: ["id"], handler: relationshipById },
  { pattern: /^\/api\/share\/([^/]+)$/, params: ["token"], handler: publicShare },
  { pattern: /^\/api\/shared$/, handler: sharedIndex },
];

export function resolveApiRoute(pathname) {
  for (const route of routes) {
    const match = route.pattern.exec(pathname);
    if (!match) continue;
    const params = {};
    for (let index = 0; index < (route.params || []).length; index += 1) {
      try { params[route.params[index]] = decodeURIComponent(match[index + 1]); }
      catch { return { malformed: true }; }
    }
    return { handler: route.handler, params };
  }
  return null;
}

export default async function handler(req, res) {
  let pathname;
  try {
    const routePath = req.query?.path;
    if (Array.isArray(routePath) && routePath.length) {
      pathname = "/api/" + routePath.join("/");
    } else if (typeof routePath === "string" && routePath.length) {
      pathname = "/api/" + routePath.replace(/^\/+/, "");
    } else {
      pathname = new URL(req.url || "/", "https://shelflife.invalid").pathname;
    }
    pathname = pathname.replace(/\/+$/, "") || "/";
  } catch {
    return res.status(400).json({ error: "Invalid request path" });
  }
  const route = resolveApiRoute(pathname);
  if (!route) return res.status(404).json({ error: "API route not found" });
  if (route.malformed) return res.status(400).json({ error: "Invalid path parameter" });
  req.query = { ...(req.query || {}), ...route.params };
  return route.handler(req, res);
}
