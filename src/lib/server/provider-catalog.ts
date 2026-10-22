import type { FeedHealth } from "@/types";

export type ProviderId =
  | "usgs" | "gdacs" | "reliefweb" | "gdelt"
  | "bbc" | "dw" | "unnews" | "globalvoices" | "france24" | "aljazeera";

export interface ProviderDefinition {
  id: ProviderId;
  name: string;
  url: string;
  publisherUrl: string;
  format: "json" | "rss";
  kind: NonNullable<FeedHealth["kind"]>;
  publisherCountry: string;
  language: string;
  termsUrl: string;
  /** A license link is attribution, not a claim that every embedded work is covered. */
  licenseUrl?: string;
  /** DW's explicit free grant covers titles and original links, not descriptions. */
  headlineOnly?: boolean;
  /** Minimum provider polling interval; BBC's feed advertises a 15-minute TTL. */
  refreshIntervalMs?: number;
  usageNote: string;
  enabled(): boolean;
  disabledMessage: string;
}

function rssEnabled(variable: string, optIn = false): boolean {
  return process.env.RSS_ENABLED !== "false" &&
    (optIn ? process.env[variable] === "true" : process.env[variable] !== "false");
}

// Fixed, server-owned HTTPS endpoints only. Article links and browser input are
// never fetch targets. Defaults support a local personal feed reader; they do not
// grant permission for a public/business deployment. See each source's terms.
export const PROVIDERS: readonly ProviderDefinition[] = [
  {
    id: "usgs",
    name: "USGS Earthquakes",
    url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson",
    publisherUrl: "https://earthquake.usgs.gov/",
    format: "json",
    kind: "primary",
    publisherCountry: "United States",
    language: "en",
    termsUrl: "https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits",
    usageNote: "USGS observations retain source attribution; source review is not independent verification.",
    enabled: () => process.env.USGS_ENABLED !== "false",
    disabledMessage: "Disabled by USGS_ENABLED=false.",
  },
  {
    id: "gdacs",
    name: "GDACS",
    url: "https://www.gdacs.org/xml/rss_7d.xml",
    publisherUrl: "https://www.gdacs.org/",
    format: "rss",
    kind: "primary",
    publisherCountry: "International",
    language: "en",
    termsUrl: "https://www.gdacs.org/About/termofuse.aspx",
    usageNote: "GDACS modeled alerts retain source acknowledgements; source alert levels are not verified impact.",
    enabled: () => process.env.GDACS_ENABLED !== "false",
    disabledMessage: "Disabled by GDACS_ENABLED=false.",
  },
  {
    id: "bbc",
    name: "BBC World",
    url: "https://feeds.bbci.co.uk/news/world/rss.xml",
    publisherUrl: "https://www.bbc.com/news",
    format: "rss",
    kind: "news",
    publisherCountry: "United Kingdom",
    language: "en",
    termsUrl: "https://www.bbc.co.uk/usingthebbc/terms-of-use/#15metadataandrssfeeds",
    refreshIntervalMs: 15 * 60_000,
    usageNote: "Personal RSS reading; BBC business/public reuse can require permission. See BBC terms.",
    enabled: () => rssEnabled("BBC_ENABLED"),
    disabledMessage: "Disabled by BBC_ENABLED=false or RSS_ENABLED=false.",
  },
  {
    id: "dw",
    name: "DW World",
    url: "https://rss.dw.com/rdf/rss-en-world",
    publisherUrl: "https://www.dw.com/",
    format: "rss",
    kind: "news",
    publisherCountry: "Germany",
    language: "en",
    termsUrl: "https://corporate.dw.com/en/general-terms-and-conditions-for-the-use-of-dw-world/a-326547",
    headlineOnly: true,
    usageNote: "DW titles and original article links only; article text and images are not republished.",
    enabled: () => rssEnabled("DW_ENABLED"),
    disabledMessage: "Disabled by DW_ENABLED=false or RSS_ENABLED=false.",
  },
  {
    id: "unnews",
    name: "UN News",
    url: "https://news.un.org/feed/subscribe/en/news/all/rss.xml",
    publisherUrl: "https://news.un.org/en/",
    format: "rss",
    kind: "humanitarian",
    publisherCountry: "International",
    language: "en",
    termsUrl: "https://www.un.org/en/about-us/terms-of-use",
    usageNote: "United Nations reporting represents its institutional perspective. Public reuse terms require operator review.",
    enabled: () => rssEnabled("UN_NEWS_ENABLED"),
    disabledMessage: "Disabled by UN_NEWS_ENABLED=false or RSS_ENABLED=false.",
  },
  {
    id: "globalvoices",
    name: "Global Voices",
    url: "https://globalvoices.org/feed/",
    publisherUrl: "https://globalvoices.org/",
    format: "rss",
    kind: "news",
    publisherCountry: "International",
    language: "en",
    termsUrl: "https://globalvoices.org/about/global-voices-attribution-policy/",
    licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
    usageNote: "Global Voices CC BY 3.0 text: retain author, original link and license. Only the plain-text feed excerpt is displayed; no images or full article.",
    enabled: () => rssEnabled("GLOBAL_VOICES_ENABLED"),
    disabledMessage: "Disabled by GLOBAL_VOICES_ENABLED=false or RSS_ENABLED=false.",
  },
  {
    id: "reliefweb",
    name: "ReliefWeb",
    url: "https://api.reliefweb.int/v2/reports",
    publisherUrl: "https://reliefweb.int/",
    format: "json",
    kind: "humanitarian",
    publisherCountry: "International",
    language: "en",
    termsUrl: "https://apidoc.reliefweb.int/",
    usageNote: "ReliefWeb indexes reports from multiple organizations; original-source rights and claims remain separate.",
    enabled: () => Boolean(process.env.RELIEFWEB_APPNAME?.trim()),
    disabledMessage: "Set RELIEFWEB_APPNAME to an approved ReliefWeb application name.",
  },
  {
    id: "gdelt",
    name: "GDELT",
    url: "https://api.gdeltproject.org/api/v2/doc/doc",
    publisherUrl: "https://www.gdeltproject.org/",
    format: "json",
    kind: "aggregator",
    publisherCountry: "Multiple",
    language: "multiple",
    termsUrl: "https://www.gdeltproject.org/about.html#termsofuse",
    usageNote: "Optional news index. First-seen time is not publication time; linked publishers retain their rights.",
    enabled: () => process.env.GDELT_ENABLED === "true",
    disabledMessage: "Optional media index; set GDELT_ENABLED=true to enable. It is not needed for the default live feeds.",
  },
  {
    id: "france24",
    name: "France 24",
    url: "https://www.france24.com/en/rss",
    publisherUrl: "https://www.france24.com/en/",
    format: "rss",
    kind: "news",
    publisherCountry: "France",
    language: "en",
    termsUrl: "https://www.francemm.com/en/legal-notice",
    usageNote: "Personal/private use only unless authorized; review France Médias Monde rights before enabling.",
    enabled: () => rssEnabled("FRANCE24_ENABLED", true),
    disabledMessage: "Optional source. Review personal/public reuse rights, then set FRANCE24_ENABLED=true; RSS_ENABLED=false overrides it.",
  },
  {
    id: "aljazeera",
    name: "Al Jazeera English",
    url: "https://www.aljazeera.com/xml/rss/all.xml",
    publisherUrl: "https://www.aljazeera.com/",
    format: "rss",
    kind: "news",
    publisherCountry: "Qatar",
    language: "en",
    termsUrl: "https://www.aljazeera.com/terms-and-conditions/",
    usageNote: "Automated access/reuse requires the publisher's authorization; reachability is not permission.",
    enabled: () => rssEnabled("ALJAZEERA_ENABLED", true),
    disabledMessage: "Optional source. Obtain applicable automated-access/reuse permission before setting ALJAZEERA_ENABLED=true.",
  },
];
