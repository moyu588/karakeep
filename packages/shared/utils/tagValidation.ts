/**
 * Tags are retrieval labels, not routing data. URL, domain and bare TLD-like
 * names should be represented by a bookmark's link (or a product name), not a
 * tag.
 */
export function isUrlLikeTag(raw: string): boolean {
  const tag = raw.trim();
  if (!tag) {
    return true;
  }

  if (/^https?:\/\//i.test(tag)) {
    return true;
  }

  if (/^www\./i.test(tag)) {
    return true;
  }

  if (tag.includes("://")) {
    return true;
  }

  // Accept known software-product names such as Node.js, but reject bare
  // domains and host/path forms such as example.com, example.com/path, or
  // foo.co.uk.
  const hostLike = /^[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+(?:\/\S*)?$/u.test(tag);
  if (
    hostLike &&
    /\.(?:js|mjs|cjs|ts|tsx|py|rs|md)$/i.test(tag) &&
    /[A-Z].*\./.test(tag)
  ) {
    return false;
  }
  return hostLike;
}

export function filterUrlLikeTags(tags: string[]): string[] {
  return tags.filter((tag) => !isUrlLikeTag(tag));
}
