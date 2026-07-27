import { env, fetchMock } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { app } from './index';
import { createDeepLink } from './openinapp';

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

function mockCreateSmartLink(webLink: string) {
  fetchMock
    .get('https://nodeapi.openinapp.com')
    .intercept({ path: '/api/v1/create-smart-link', method: 'POST' })
    .reply(200, {
      status: 1,
      message: 'Link created successfully',
      statusCode: 200,
      data: { web_link: webLink },
    });
}

function mockCreateSmartLinkError(status: number) {
  fetchMock
    .get('https://nodeapi.openinapp.com')
    .intercept({ path: '/api/v1/create-smart-link', method: 'POST' })
    .reply(status, { error: 'mocked failure' });
}

describe('createDeepLink', () => {
  it('returns the web_link from the API response', async () => {
    mockCreateSmartLink('https://amzn.openinapp.co/ti880');
    const link = await createDeepLink('fake-key', 'https://amazon.com');
    expect(link).toBe('https://amzn.openinapp.co/ti880');
  });

  it('throws on a non-200 response', async () => {
    mockCreateSmartLinkError(403);
    await expect(createDeepLink('fake-key', 'https://amazon.com')).rejects.toThrow();
  });
});

describe('POST /api/openinapp', () => {
  it('returns the deep link on success', async () => {
    mockCreateSmartLink('https://amzn.openinapp.co/ti880');
    const res = await app.request(
      '/api/openinapp',
      { method: 'POST', body: JSON.stringify({ url: 'https://amazon.com' }) },
      env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toBe('https://amzn.openinapp.co/ti880');
  });

  it('returns 400 when url is missing', async () => {
    const res = await app.request('/api/openinapp', { method: 'POST', body: JSON.stringify({}) }, env);
    expect(res.status).toBe(400);
  });

  it('returns 502 on API failure', async () => {
    mockCreateSmartLinkError(500);
    const res = await app.request(
      '/api/openinapp',
      { method: 'POST', body: JSON.stringify({ url: 'https://amazon.com' }) },
      env
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });
});
