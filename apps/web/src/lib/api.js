// apps/web/src/lib/api.js
import axios from "axios";

const baseURL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";

export const api = axios.create({
  baseURL,
  withCredentials: false,
});

// read token from localStorage on startup
function getStoredToken() {
  try {
    return localStorage.getItem("token");
  } catch {
    return null;
  }
}

// write token (used by AuthContext, App, etc.)
export function setAuthToken(token) {
  try {
    if (token) {
      localStorage.setItem("token", token);
      api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    } else {
      localStorage.removeItem("token");
      delete api.defaults.headers.common["Authorization"];
    }
  } catch {
    // ignore
  }
}

// init once
const initialToken = getStoredToken();
if (initialToken) {
  api.defaults.headers.common["Authorization"] = `Bearer ${initialToken}`;
}

// ✅ helper: routes that are allowed to fail without logging the user out
const SOFT_ROUTES = [
  "/api/me",
  "/api/profile/client/me",
  "/api/profile/me",
];

// request interceptor (nothing fancy)
api.interceptors.request.use(
  (config) => {
    // make sure we always send latest token
    const t = getStoredToken();
    if (t) {
      config.headers["Authorization"] = `Bearer ${t}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// response interceptor
api.interceptors.response.use(
  (res) => res,
  (error) => {
    const { response, config } = error || {};
    const status = response?.status;
    const url = config?.url || "";

    // if it's not 401, just bubble up
    if (status !== 401) {
      return Promise.reject(error);
    }

    // ✅ if it's a soft route, DON'T clear token — just let component handle "guest"
    if (SOFT_ROUTES.some((r) => url.includes(r))) {
      return Promise.reject(error);
    }

    // ✅ for other 401s, clear token so app can redirect to /login
    try {
      localStorage.removeItem("token");
    } catch {}
    delete api.defaults.headers.common["Authorization"];

    return Promise.reject(error);
  }
);
