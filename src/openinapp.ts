export class OpenInAppApiError extends Error {}

const BASE_URL = 'https://nodeapi.openinapp.com/api/v1';

interface CreateSmartLinkResponse {
  data?: {
    web_link?: string;
  };
}

export async function createDeepLink(apiKey: string, url: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/create-smart-link`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    throw new OpenInAppApiError(`OpenInApp API request failed: ${res.status} ${errorBody}`.trim());
  }

  const body = (await res.json()) as CreateSmartLinkResponse;
  const deepLink = body.data?.web_link;
  if (!deepLink) {
    throw new OpenInAppApiError('OpenInApp API response missing web_link');
  }

  return deepLink;
}
