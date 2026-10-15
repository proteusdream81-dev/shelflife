import React from "react";
import { MessageCircle } from "lucide-react";
import AppNav from "@/components/tbr/AppNav";
import AgentChat from "@/components/agent/AgentChat";
import GroupInvitesCard from "@/components/tbr/GroupInvitesCard";

const SUGGESTIONS = [
  "Which book clubs can I join?",
  "Do I have invites waiting?",
  "Find a club reading fantasy",
];

export default function BookClubHost() {
  return (
    <div className="vp-page">
      <header className="vp-top">
        <div className="vp-topin max-w-3xl mx-auto">
          <div className="vp-bar">
            <div className="vp-brand">
              <div className="vp-mark">
                <MessageCircle strokeWidth={1.8} />
              </div>
              <div className="vp-brandtxt">
                <strong>Book clubs</strong>
                <span>Find a club, and sort out your invites</span>
              </div>
            </div>
            <AppNav />
          </div>
        </div>
      </header>

      <main className="vp-main max-w-3xl mx-auto">
        <GroupInvitesCard />
        <AgentChat
          greeting="I'm your book club host. I can look up the clubs you can join, tell you what's waiting in your invites, and sort those invites out for you."
          suggestions={SUGGESTIONS}
        />
      </main>
    </div>
  );
}