import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseImageTarget, extractImageMatches, replaceImagesWithBase64, guessMimeType } from './image-downloader';
import browser from './browser-polyfill';

vi.mock('./browser-polyfill', () => ({
    default: {
        runtime: {
            sendMessage: vi.fn(),
        },
    },
}));

describe('parseImageTarget', () => {
    it('parses standard image URL without title', () => {
        const target = parseImageTarget('https://example.com/image.png');
        expect(target.cleanUrl).toBe('https://example.com/image.png');
        expect(target.title).toBeUndefined();
    });

    it('parses image URL with title in double quotes', () => {
        const target = parseImageTarget('https://xxxxv1/image/preview/7c8e4348-4a23-492b-9e8d-6bd0fd02286a_977x295.PNG "Picture1.png"');
        expect(target.cleanUrl).toBe('https://xxxxv1/image/preview/7c8e4348-4a23-492b-9e8d-6bd0fd02286a_977x295.PNG');
        expect(target.title).toBe('Picture1.png');
    });

    it('parses image URL with query params', () => {
        const target = parseImageTarget('https://xxxxx655x154.png?_=1762738032324');
        expect(target.cleanUrl).toBe('https://xxxxx655x154.png?_=1762738032324');
        expect(target.title).toBeUndefined();
    });

    it('parses image URL with Chinese title', () => {
        const target = parseImageTarget('https://xxxxxb-f346-49ac-bac5-0371ce1ab064_1825x793.png "长按可移动图片，拉伸锚点可缩放图片"');
        expect(target.cleanUrl).toBe('https://xxxxxb-f346-49ac-bac5-0371ce1ab064_1825x793.png');
        expect(target.title).toBe('长按可移动图片，拉伸锚点可缩放图片');
    });

    it('cleans malformed trailing quotes or brackets', () => {
        const target = parseImageTarget('https://xxxxxx.png"');
        expect(target.cleanUrl).toBe('https://xxxxxx.png');

        const target2 = parseImageTarget('<https://example.com/image.png> "My Title"');
        expect(target2.cleanUrl).toBe('https://example.com/image.png');
        expect(target2.title).toBe('My Title');
    });
});

describe('guessMimeType', () => {
    it('guesses mime type stripping query params and hashes', () => {
        expect(guessMimeType('https://example.com/image.png?v=123#test')).toBe('image/png');
        expect(guessMimeType('https://example.com/photo.jpeg?_=9876')).toBe('image/jpeg');
        expect(guessMimeType('https://example.com/anim.webp')).toBe('image/webp');
    });
});

describe('extractImageMatches', () => {
    it('extracts markdown images and table context', () => {
        const markdown = `
![Picture1.png](https://xxxxv1/image/preview/7c8e4348-4a23-492b-9e8d-6bd0fd02286a_977x295.PNG "Picture1.png")

| ![agentic-workflow-waterfall.png](https://xxxxxx.png") |
| ------------------------------------------------------ |
| 图1：xxxxxxx                                             |
`;
        const matches = extractImageMatches(markdown);
        expect(matches.length).toBe(2);

        expect(matches[0].isTableLine).toBe(false);
        expect(matches[0].cleanUrl).toBe('https://xxxxv1/image/preview/7c8e4348-4a23-492b-9e8d-6bd0fd02286a_977x295.PNG');
        expect(matches[0].title).toBe('Picture1.png');

        expect(matches[1].isTableLine).toBe(true);
        expect(matches[1].cleanUrl).toBe('https://xxxxxx.png');
        expect(matches[1].alt).toBe('agentic-workflow-waterfall.png');
    });
});

describe('replaceImagesWithBase64', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('converts markdown table images into <img> tags with base64 data', async () => {
        vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
            dataUri: 'data:image/png;base64,mockBase64Data',
        });

        const markdown = `
| ![agentic-workflow-waterfall.png](https://xxxxxx.png") |
| ------------------------------------------------------ |
| 图1：xxxxxxx                                             |
`;

        const result = await replaceImagesWithBase64(markdown, 1);
        expect(result).toContain('| <img src="data:image/png;base64,mockBase64Data" alt="agentic-workflow-waterfall.png"> |');
    });

    it('handles image URLs with titles and query params outside tables', async () => {
        vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
            dataUri: 'data:image/png;base64,mockBase64Data',
        });

        const markdown = `
![Picture1.png](https://xxxxv1/image/preview/7c8e4348-4a23-492b-9e8d-6bd0fd02286a_977x295.PNG "Picture1.png")

![](https://xxxxx655x154.png?_=1762738032324)
`;

        const result = await replaceImagesWithBase64(markdown, 1);
        expect(result).toContain('![Picture1.png](data:image/png;base64,mockBase64Data "Picture1.png")');
        expect(result).toContain('![](data:image/png;base64,mockBase64Data)');
    });
});
