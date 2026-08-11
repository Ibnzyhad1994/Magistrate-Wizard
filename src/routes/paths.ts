/**
 * Centralized route path constants. Import these instead of hardcoding
 * strings so route changes only need to happen in one place.
 */
export const ROUTES = {
  home: "/",
  dashboard: "/dashboard",
  login: "/login",
  register: "/register",
  forgotPassword: "/forgot-password",
  unauthorized: "/unauthorized",
  notFound: "*",
} as const;

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];
