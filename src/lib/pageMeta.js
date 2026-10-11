// Social platforms read the preview tags off the page, so a shared link can name
// the shelf and its owner instead of showing the app's own generic title.
const setMeta = (attribute, key, content) => {
  if (!content) return;
  let tag = document.head.querySelector(`meta[${attribute}="${key}"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(attribute, key);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
};

export function applyShareMeta({ title, description, image }) {
  if (title) document.title = title;
  ["og", "twitter"].forEach((prefix) => {
    const attribute = prefix === "og" ? "property" : "name";
    setMeta(attribute, `${prefix}:title`, title);
    setMeta(attribute, `${prefix}:description`, description);
    setMeta(attribute, `${prefix}:image`, image);
  });
}