import React from "react";
import { Download, MousePointerClick, Smartphone } from "lucide-react";

// The closed-beta link for the Android build. It has to be opened on the phone itself, because
// tapping "Become a tester" only opts in the Google account the phone is signed into.
export const BETA_OPT_IN_URL = "https://play.google.com/apps/testing/com.codelustre.shelflifeapp";

const STEPS = [
  {
    icon: Smartphone,
    title: "Open the testing link on your Android phone",
    body: (
      <>
        Type or paste{" "}
        <a
          href={BETA_OPT_IN_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-4 break-all"
        >
          play.google.com/apps/testing/com.codelustre.shelflifeapp
        </a>{" "}
        into your phone's browser. Doing it on the phone is what matters, not on a laptop.
      </>
    ),
  },
  {
    icon: MousePointerClick,
    title: 'Tap "Become a tester"',
    body: "The page asks you to join the closed test. Accept it with the Google account you want ShelfLife attached to.",
  },
  {
    icon: Download,
    title: "Install ShelfLife and log your first book",
    body: 'The page then offers the Play Store listing. Install the app, sign in, and add one book - scan the barcode or search the title. That first shelf is all we ask for.',
  },
];

export default function BetaSteps() {
  return (
    <section className="vp-shelf">
      <div className="vp-shelfhead">
        <div className="vp-titleline">
          <h2>Three steps, about two minutes</h2>
        </div>
      </div>

      <ol className="space-y-4">
        {STEPS.map(({ icon: Icon, title, body }, index) => (
          <li key={title} className="flex gap-3.5">
            <div className="flex-none flex flex-col items-center">
              <span className="w-8 h-8 rounded-full grid place-items-center bg-primary text-primary-foreground text-sm font-bold">
                {index + 1}
              </span>
              <Icon className="w-5 h-5 mt-2 text-primary/70" strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <h3 className="font-heading text-lg leading-snug text-foreground">{title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-5 rounded-xl border border-primary/30 bg-muted/40 p-3.5">
        <p className="text-[13px] leading-relaxed text-foreground/90">
          <strong className="text-primary">Two things to know:</strong> testers need an Android phone
          and a Google account, and you should stay opted in for at least 14 days for your test to
          count.
        </p>
      </div>
    </section>
  );
}