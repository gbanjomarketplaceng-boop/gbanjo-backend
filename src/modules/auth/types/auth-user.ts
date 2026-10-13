/** What the JWT guard attaches to `request.user`. */
export interface AuthUser {
  id: string;
  role: "USER" | "ADMIN";
  sessionId: string;
}

/** Access-token claims. */
export interface JwtPayload {
  sub: string;
  role: "USER" | "ADMIN";
  /** Session (device) id — lets logout revoke a token before it expires. */
  sid: string;
}
