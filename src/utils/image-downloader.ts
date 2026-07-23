import browser from './browser-polyfill';

const IMAGE_DOWNLOAD_TIMEOUT = 15000; // 15 seconds per image

export interface ImageTarget {
    cleanUrl: string;
    title?: string;
}

export interface ExtractedImageMatch {
    fullMatch: string;
    alt: string;
    cleanUrl: string;
    title?: string;
    isHtml: boolean;
    isTableLine: boolean;
}

/**
 * Parse Markdown image destination string to extract clean URL and optional title.
 * Examples:
 *   'https://domain.com/pic.png "Picture1.png"' => { cleanUrl: 'https://domain.com/pic.png', title: 'Picture1.png' }
 *   '<https://domain.com/pic.png> "title"' => { cleanUrl: 'https://domain.com/pic.png', title: 'title' }
 *   'https://domain.com/pic.png"' => { cleanUrl: 'https://domain.com/pic.png', title: undefined }
 */
export function parseImageTarget(destination: string): ImageTarget {
    let text = destination.trim();
    let title: string | undefined;

    // Check for title in quotes/parens at the end: "title", 'title', (title)
    const titleMatch = text.match(/\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\))\s*$/);
    if (titleMatch) {
        title = titleMatch[1] ?? titleMatch[2] ?? titleMatch[3];
        text = text.substring(0, titleMatch.index).trim();
    }

    // Strip wrapping angle brackets <...> if present
    if (text.startsWith('<') && text.endsWith('>')) {
        text = text.slice(1, -1).trim();
    } else if (text.startsWith('<')) {
        const closingIdx = text.indexOf('>');
        if (closingIdx > 0) {
            text = text.substring(1, closingIdx).trim();
        }
    }

    // Clean trailing/leading quotes, brackets or whitespace
    text = text.replace(/["'>\s]+$/, '').replace(/^["'<\s]+/, '');

    return { cleanUrl: text, title };
}

/**
 * Download an image and convert it to a base64 data URI.
 * This function is designed to run in the content script context
 * where it has access to the page's cookies and session.
 */
export async function downloadImageAsBase64(url: string): Promise<string | null> {
    try {
        const { cleanUrl } = parseImageTarget(url);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), IMAGE_DOWNLOAD_TIMEOUT);

        const response = await fetch(cleanUrl, {
            signal: controller.signal,
            credentials: 'include',
            mode: 'cors',
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            console.warn(`Failed to download image: ${cleanUrl} (${response.status})`);
            return null;
        }

        const blob = await response.blob();
        const mimeType = (blob.type && blob.type !== 'application/octet-stream')
            ? blob.type
            : guessMimeType(cleanUrl);

        return new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = reader.result as string;
                resolve(base64);
            };
            reader.onerror = () => {
                console.warn(`Failed to read image as base64: ${cleanUrl}`);
                resolve(null);
            };
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            console.warn(`Image download timed out: ${url}`);
        } else {
            console.warn(`Error downloading image: ${url}`, error);
        }
        return null;
    }
}

/**
 * Guess MIME type from URL file extension
 */
export function guessMimeType(url: string): string {
    const cleanPath = url.split('?')[0].split('#')[0];
    const ext = cleanPath.split('.').pop()?.toLowerCase();
    const mimeMap: { [key: string]: string } = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'svg': 'image/svg+xml',
        'bmp': 'image/bmp',
        'ico': 'image/x-icon',
        'avif': 'image/avif',
    };
    return mimeMap[ext || ''] || 'image/png';
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Extract image matches (Markdown images & HTML <img> tags) line-by-line.
 */
export function extractImageMatches(markdown: string): ExtractedImageMatch[] {
    const lines = markdown.split(/\r?\n/);
    const matches: ExtractedImageMatch[] = [];

    for (const line of lines) {
        const isTableLine = line.includes('|');

        // 1. Match Markdown images: ![alt](destination)
        // Skip data: URIs
        const mdRegex = /!\[([^\]]*)\]\((?!data:)((?:[^()]*|\([^()]*\))*)\)/g;
        let mdMatch: RegExpExecArray | null;
        while ((mdMatch = mdRegex.exec(line)) !== null) {
            const fullMatch = mdMatch[0];
            const alt = mdMatch[1];
            const destination = mdMatch[2];
            const { cleanUrl, title } = parseImageTarget(destination);

            if (cleanUrl && (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://') || cleanUrl.startsWith('//'))) {
                const finalUrl = cleanUrl.startsWith('//') ? 'https:' + cleanUrl : cleanUrl;
                matches.push({
                    fullMatch,
                    alt,
                    cleanUrl: finalUrl,
                    title,
                    isHtml: false,
                    isTableLine,
                });
            }
        }

        // 2. Match HTML <img> tags: <img ... src="url" ...>
        const htmlRegex = /<img\s+[^>]*src=["'](?!data:)([^"']+)["'][^>]*>/gi;
        let htmlMatch: RegExpExecArray | null;
        while ((htmlMatch = htmlRegex.exec(line)) !== null) {
            const fullMatch = htmlMatch[0];
            const altMatch = fullMatch.match(/alt=["']([^"']*)["']/i);
            const titleMatch = fullMatch.match(/title=["']([^"']*)["']/i);
            const alt = altMatch ? altMatch[1] : '';
            const title = titleMatch ? titleMatch[1] : undefined;
            const rawUrl = htmlMatch[1].trim();
            const { cleanUrl } = parseImageTarget(rawUrl);

            if (cleanUrl && (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://') || cleanUrl.startsWith('//'))) {
                const finalUrl = cleanUrl.startsWith('//') ? 'https:' + cleanUrl : cleanUrl;
                matches.push({
                    fullMatch,
                    alt,
                    cleanUrl: finalUrl,
                    title,
                    isHtml: true,
                    isTableLine,
                });
            }
        }
    }

    return matches;
}

/**
 * Replace all image URLs in markdown with base64 data URIs.
 * 
 * @param markdown The markdown content with image URLs
 * @param tabId The tab ID to send download requests to
 * @returns The markdown with images replaced by base64 data URIs
 */
export async function replaceImagesWithBase64(markdown: string, tabId: number): Promise<string> {
    const matches = extractImageMatches(markdown);

    if (matches.length === 0) {
        return markdown;
    }

    // Deduplicate URLs
    const uniqueUrls = [...new Set(matches.map(m => m.cleanUrl))];

    console.log(`Downloading ${uniqueUrls.length} unique images...`);

    const urlToBase64Map = new Map<string, string | null>();

    await Promise.all(
        uniqueUrls.map(async (url) => {
            try {
                const response = await browser.runtime.sendMessage({
                    action: 'downloadImageAsBase64',
                    url: url
                }) as { dataUri: string | null };

                urlToBase64Map.set(url, response?.dataUri || null);
            } catch (error) {
                console.warn(`Failed to download image via content script: ${url}`, error);
                urlToBase64Map.set(url, null);
            }
        })
    );

    let result = markdown;
    for (const m of matches) {
        const base64 = urlToBase64Map.get(m.cleanUrl);
        if (base64) {
            let replacement: string;

            if (m.isHtml) {
                // Replace src="..." attribute inside HTML <img> tag
                replacement = m.fullMatch.replace(/src=["']([^"']+)["']/i, `src="${base64}"`);
            } else if (m.isTableLine) {
                // Markdown image inside table cell: convert to HTML <img> tag for proper Markdown table rendering
                const altAttr = m.alt ? ` alt="${escapeHtml(m.alt)}"` : '';
                const titleAttr = m.title ? ` title="${escapeHtml(m.title)}"` : '';
                replacement = `<img src="${base64}"${altAttr}${titleAttr}>`;
            } else {
                // Standard markdown image outside of table
                let filename = m.title;
                if (!filename) {
                    try {
                        const cleanPath = m.cleanUrl.split('?')[0].split('#')[0];
                        const urlObj = new URL(cleanPath);
                        const lastPart = urlObj.pathname.split('/').pop();
                        if (lastPart && lastPart.includes('.')) {
                            filename = decodeURIComponent(lastPart);
                        }
                    } catch (e) {
                        // Ignore URL parsing errors
                    }
                }
                const titlePart = filename ? ` "${filename}"` : '';
                replacement = `![${m.alt}](${base64}${titlePart})`;
            }

            result = result.replace(m.fullMatch, replacement);
        }
    }

    const successCount = [...urlToBase64Map.values()].filter(v => v !== null).length;
    console.log(`Successfully downloaded ${successCount}/${uniqueUrls.length} images`);

    return result;
}
