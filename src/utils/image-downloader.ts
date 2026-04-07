import browser from './browser-polyfill';

const IMAGE_DOWNLOAD_TIMEOUT = 15000; // 15 seconds per image

/**
 * Download an image and convert it to a base64 data URI.
 * This function is designed to run in the content script context
 * where it has access to the page's cookies and session.
 */
export async function downloadImageAsBase64(url: string): Promise<string | null> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), IMAGE_DOWNLOAD_TIMEOUT);

        const response = await fetch(url, {
            signal: controller.signal,
            credentials: 'include',
            mode: 'cors',
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            console.warn(`Failed to download image: ${url} (${response.status})`);
            return null;
        }

        const blob = await response.blob();
        const mimeType = blob.type || guessMimeType(url);

        return new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = reader.result as string;
                // FileReader.readAsDataURL already returns data:...;base64,...
                resolve(base64);
            };
            reader.onerror = () => {
                console.warn(`Failed to read image as base64: ${url}`);
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
function guessMimeType(url: string): string {
    const ext = url.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase();
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

/**
 * Replace all image URLs in markdown with base64 data URIs.
 * 
 * This sends messages to the content script to download images
 * within the page's context (with cookies/session).
 * 
 * @param markdown The markdown content with image URLs
 * @param tabId The tab ID to send download requests to
 * @returns The markdown with images replaced by base64 data URIs
 */
export async function replaceImagesWithBase64(markdown: string, tabId: number): Promise<string> {
    // Match markdown images: ![alt](url)
    // Don't match images that are already data URIs
    const imageRegex = /!\[([^\]]*)\]\((?!data:)((?:[^()]*|\([^()]*\))*)\)/g;

    const matches: { fullMatch: string; alt: string; url: string }[] = [];
    let match;

    while ((match = imageRegex.exec(markdown)) !== null) {
        matches.push({
            fullMatch: match[0],
            alt: match[1],
            url: match[2].trim(),
        });
    }

    if (matches.length === 0) {
        return markdown;
    }

    // Deduplicate URLs to avoid downloading the same image twice
    const uniqueUrls = [...new Set(matches.map(m => m.url))];

    console.log(`Downloading ${uniqueUrls.length} unique images...`);

    // Download all unique images in parallel via the content script
    const urlToBase64Map = new Map<string, string | null>();

    const results = await Promise.all(
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

    // Replace all image URLs with base64 data URIs
    let result = markdown;
    for (const m of matches) {
        const base64 = urlToBase64Map.get(m.url);
        if (base64) {
            let filename = 'image';
            try {
                const urlObj = new URL(m.url);
                const lastPart = urlObj.pathname.split('/').pop();
                if (lastPart && lastPart.includes('.')) {
                    // Try to decode URI component for beautiful filenames
                    filename = decodeURIComponent(lastPart);
                }
            } catch (e) {
                // Ignore URL parsing errors
            }
            const replacement = `![${m.alt}](${base64} "${filename}")`;
            result = result.replace(m.fullMatch, replacement);
        }
        // If base64 is null, keep the original URL
    }

    const successCount = [...urlToBase64Map.values()].filter(v => v !== null).length;
    console.log(`Successfully downloaded ${successCount}/${uniqueUrls.length} images`);

    return result;
}
