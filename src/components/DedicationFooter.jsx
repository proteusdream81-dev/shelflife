import React from "react";

// The dedication, held at the foot of every page: the name, then a small greyhound sketch in
// the same rose. It sits in the normal flow, so it never covers a control or takes a tap, and
// it is quiet enough to be read only when the reader has come to the end of the page.
// The prepared sketch, fetched from the address its own share link resolves to, so the image
// is asked for once with no redirect in front of it.
const GREYHOUND_SKETCH = "https://media.base44.com/images/public/6acb4bff5b2cf5faa0b3fd45/7693b1702_greyhound-sketch-pink.png";

export default function DedicationFooter() {
  return (
    <footer className="vp-dedication">
      For Jodi
      <img
        className="vp-dedication-mark"
        src={GREYHOUND_SKETCH}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
      />
    </footer>
  );
}