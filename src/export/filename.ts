/**
 * Azure DevOps wiki page names on disk: space → "-", and the characters ADO reserves are
 * percent-encoded, "-" included (as "%2D", so a decoded "-" is a space). "%" itself is encoded
 * too so decoding is unambiguous. ADO documents the reserved set; "%2D" and "%25" follow common
 * practice and are unverified against a live ADO instance.
 */
const ENCODE: Record<string, string> = {
  "%": "%25",
  "-": "%2D",
  ":": "%3A",
  "<": "%3C",
  ">": "%3E",
  "*": "%2A",
  "?": "%3F",
  "|": "%7C",
  '"': "%22",
  " ": "-",
};

export function encodePageName(title: string): string {
  return Array.from(title, (ch) => ENCODE[ch] ?? ch).join("");
}

export function decodePageName(name: string): string {
  return name.replace(/%([0-9A-Fa-f]{2})|-/g, (m, hex: string | undefined) =>
    hex ? String.fromCharCode(parseInt(hex, 16)) : " ",
  );
}
