import { fetchJson, fetchText, mapWithConcurrency } from './utils';
import type { NewsItem } from '../shared/types';

const SITE_URL = 'https://www.minecraft.net';
const ARTICLE_ENDPOINT = `${SITE_URL}/content/minecraftnet/language-masters/en-us/_jcr_content.articles.page-1.json`;
const CACHE_MS = 5 * 60_000;

interface MinecraftNetTile {
  title?: string;
  sub_header?: string;
  image?: { imageURL?: string };
}

interface MinecraftNetArticle {
  default_tile?: MinecraftNetTile;
  primary_category?: string;
  article_url?: string;
}

interface MinecraftNetResponse {
  article_grid?: MinecraftNetArticle[];
}

let cached: { items: NewsItem[]; at: number } | null = null;

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, SITE_URL).toString();
  } catch {
    return undefined;
  }
}

async function publishedDate(articleUrl: string): Promise<string> {
  try {
    const html = await fetchText(articleUrl, 8_000);
    const match = html.match(/article:published_time"\s+content="([^"]+)"/i)
      ?? html.match(/"datePublished"\s*:\s*"([^"]+)"/i);
    if (!match?.[1]) return '';
    const date = new Date(match[1]);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
  } catch (error) {
    console.warn('[News] Article date unavailable:', articleUrl, error);
    return '';
  }
}

async function minecraftNetNews(): Promise<NewsItem[]> {
  const data = await fetchJson<MinecraftNetResponse>(ARTICLE_ENDPOINT, undefined, 15_000);
  const articles = Array.isArray(data.article_grid) ? data.article_grid : [];

  const items: NewsItem[] = articles.slice(0, 12).flatMap((article, index) => {
    const tile = article.default_tile;
    const title = stripHtml(tile?.title ?? '');
    const link = absoluteUrl(article.article_url);
    if (!title || !link) return [];

    const category = stripHtml(article.primary_category ?? '') || 'Minecraft.net';
    const excerpt = stripHtml(tile?.sub_header ?? '') || `Official ${category} news from Minecraft.net.`;
    const image = absoluteUrl(tile?.image?.imageURL);

    return [{
      id: article.article_url || `minecraft-net-${index}`,
      title,
      link,
      date: 'Minecraft.net',
      excerpt,
      image,
      category,
    }];
  });

  const enriched = await mapWithConcurrency(items.slice(0, 6), 4, async (item) => ({
    ...item,
    date: (await publishedDate(item.link)) || 'Minecraft.net',
  }));

  return [...enriched, ...items.slice(6)];
}

async function versionNews(): Promise<NewsItem[]> {
  try {
    const manifest = await fetchJson<{
      latest: { release: string; snapshot: string };
      versions: Array<{ id: string; type: string; releaseTime: string }>;
    }>('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
    const picks = [
      ...manifest.versions.filter((item) => item.id === manifest.latest.release).slice(0, 1),
      ...manifest.versions.filter((item) => item.id === manifest.latest.snapshot && item.id !== manifest.latest.release).slice(0, 1),
      ...manifest.versions.filter((item) => item.type === 'release' && item.id !== manifest.latest.release).slice(0, 4),
    ];
    return picks.map((version) => ({
      id: `mojang-${version.id}`,
      title: `Minecraft Java Edition ${version.id} is available`,
      link: 'https://www.minecraft.net/en-us',
      date: new Date(version.releaseTime).toLocaleDateString(),
      excerpt: `A new ${version.type === 'release' ? 'stable release' : 'snapshot'} is ready to play. Update your instance from the version list.`,
      category: 'Game Update',
    }));
  } catch (error) {
    console.warn('[News] Version manifest unavailable:', error);
    return [];
  }
}

export async function getNews(): Promise<NewsItem[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.items;

  let items: NewsItem[] = [];
  try {
    items = await minecraftNetNews();
  } catch (error) {
    console.warn('[News] Minecraft.net unavailable, using Mojang version feed:', error);
  }

  if (!items.length) items = await versionNews();
  cached = { items, at: Date.now() };
  return items;
}
