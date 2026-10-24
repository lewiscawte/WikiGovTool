import { Request } from 'express';
import { userAgent } from '../config';

export async function getCsrfToken(req: Request, apiUrl: string): Promise<string> {
  const token = req.session.oauth?.accessToken;
  if (!token) {
    throw new Error('No OAuth access token available');
  }
  const url = `${apiUrl}?action=query&meta=tokens&type=csrf&format=json`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': userAgent(),
    },
  });
  if (!resp.ok) {
    throw new Error(`Failed to fetch CSRF token: ${resp.status}`);
  }
  const data = (await resp.json()) as any;
  const csrf = data?.query?.tokens?.csrftoken;
  if (!csrf || csrf === '+\\') {
    throw new Error('Invalid CSRF token received');
  }
  return csrf;
}

export async function wikimediaApiPost(
  req: Request,
  apiUrl: string,
  params: Record<string, string>,
): Promise<any> {
  const token = req.session.oauth?.accessToken;
  if (!token) {
    throw new Error('No OAuth access token available');
  }
  const csrf = await getCsrfToken(req, apiUrl);
  const body = new URLSearchParams({ ...params, token: csrf, format: 'json' });
  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': userAgent(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = await resp.json();
  return data;
}
