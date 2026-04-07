import axios, { AxiosError, type AxiosInstance } from 'axios';
import type { ApiError } from '@/types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

export const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30_000,
});

// ─── Request interceptor: attach auth token ───────────────────────────────────
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('eom_access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// ─── Response interceptor: normalize errors ───────────────────────────────────
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ detail?: string | { code?: string; reason?: string } }>) => {
    let normalized: ApiError;

    if (error.response) {
      const detail = error.response.data?.detail;
      if (typeof detail === 'object' && detail !== null) {
        normalized = {
          code: detail.code ?? `HTTP_${error.response.status}`,
          message: detail.reason ?? 'An unexpected error occurred.',
        };
      } else {
        normalized = {
          code: `HTTP_${error.response.status}`,
          message: typeof detail === 'string' ? detail : error.message,
        };
      }

      // Token expired — clear storage and redirect to login
      if (error.response.status === 401) {
        localStorage.removeItem('eom_access_token');
        window.location.href = '/';
      }
    } else if (error.request) {
      normalized = {
        code: 'NETWORK_ERROR',
        message: 'Could not reach the server. Check your connection.',
      };
    } else {
      normalized = {
        code: 'CLIENT_ERROR',
        message: error.message,
      };
    }

    return Promise.reject(normalized);
  },
);

export default apiClient;
