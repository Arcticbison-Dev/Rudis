import { config } from "dotenv";
config();

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:5000";
const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN || "";

export interface RequestOptions {
  method?: string;
  body?: any;
  headers?: Record<string, string>;
  adminAuth?: boolean;
}

export async function api(path: string, options: RequestOptions = {}): Promise<{ status: number; body: any }> {
  const { method = "GET", body, headers = {}, adminAuth = false } = options;

  const fetchHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...headers,
  };

  if (adminAuth) {
    fetchHeaders["Authorization"] = `Bearer ${ADMIN_TOKEN}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: fetchHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });

  let responseBody: any;
  try {
    responseBody = await res.json();
  } catch {
    responseBody = null;
  }

  return { status: res.status, body: responseBody };
}

export function randomDescription(): string {
  return `Test invoice ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
